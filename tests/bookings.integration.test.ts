import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Stripe from "stripe";
import { prepareDeposit, recordStripeDeposit, syncDeposit } from "../lib/server/payments.ts";
import { pool } from "../lib/server/db.ts";
import { availability, calendarAvailability, quote, createBooking, guestMutation, readBooking, staffLink, staffMutation, sweep, recover } from "../lib/server/bookings.ts";
import { TERMS_VERSION } from "../lib/booking-policy.ts";
import { runJobs } from "../lib/server/jobs.ts";

const url = process.env.TEST_DATABASE_URL;
test("PostgreSQL booking lifecycle and concurrency", { skip: !url }, async t => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const isolated = new URL(url!); isolated.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = isolated.toString(); process.env.BOOKING_SECRET = "integration-test-secret-never-use-in-production";
  process.env.APP_URL = "http://localhost:3000"; process.env.BOOKING_MODE = "test"; process.env.BOOKING_TAX_BPS = "0";
  await pool().query(await readFile(new URL("../db/migrations/001_booking.sql", import.meta.url), "utf8"));
  await pool().query(await readFile(new URL("../db/migrations/002_security.sql", import.meta.url), "utf8"));
  await pool().query(await readFile(new URL("../db/migrations/003_audit_snapshots.sql", import.meta.url), "utf8"));
  process.env.STRIPE_SECRET_KEY = "sk_test_integration";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_integration";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration";
  const intents = new Map<string, Stripe.PaymentIntent>();
  const intentPrototype = Object.getPrototypeOf(new Stripe("sk_test_integration").paymentIntents);
  const created = t.mock.method(intentPrototype, "create", async (params: Stripe.PaymentIntentCreateParams, options: Stripe.RequestOptions) => {
    const id = `pi_${options.idempotencyKey!.split(":")[1]}`;
    if (intents.has(id)) return intents.get(id)!;
    const intent = { id, amount: params.amount, amount_received: 0, currency: params.currency, livemode: false,
      metadata: params.metadata, status: "requires_payment_method", client_secret: `${id}_secret_test` } as Stripe.PaymentIntent;
    intents.set(id, intent); return intent;
  });
  t.mock.method(intentPrototype, "retrieve", async (id: string) => {
    if (!intents.has(id)) throw new Error("Unknown intent");
    return intents.get(id)!;
  });
  const now = Date.parse("2026-09-24T12:00:00Z");
  function input(start = "2026-09-27T14:00:00Z", end = "2026-09-27T18:00:00Z") {
    return { requestKey: randomUUID(), termsVersion: TERMS_VERSION, quotedTotal: (Date.parse(end) - Date.parse(start)) / 3600000 * 5000, customer: { artist: "Test artist", email: `${randomUUID()}@example.com`, phone: "+12125550123" }, slot: { start, end, room: "control" as const } };
  }
  async function fresh() { await pool().query("TRUNCATE booking_jobs, booking_events, studio_occupancy, bookings, booking_rate_limits CASCADE"); }
  async function paid(r: Awaited<ReturnType<typeof createBooking>>, at = now) {
    if (!intents.has(`pi_${r.booking.id}`)) await prepareDeposit(r.token, now);
    const intent = intents.get(`pi_${r.booking.id}`)!;
    intent.status = "succeeded"; intent.amount_received = intent.amount;
    return (await recordStripeDeposit(intent, at))!;
  }
  async function confirmed(data = input()) {
    const r = await createBooking(data, now), credential = await staffLink(r.booking.id);
    let b = await paid(r);
    b = await staffMutation(credential, { action: "approve", version: b.version }, now);
    return { ...r, booking: b, staff: credential };
  }
  try {
    await t.test("simultaneous room requests cannot double-book the shared studio", async () => {
      await fresh(); const a = input(), b = { ...input(), slot: { ...a.slot, room: "studio" } };
      const results = await Promise.allSettled([createBooking(a, now), createBooking(b, now)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal((await pool().query("SELECT count(*) FROM studio_occupancy")).rows[0].count, "1");
    });
    await t.test("quote, create, and change enforce the 23-hour limit", async () => {
      await fresh();
      const tooLong = input("2026-09-27T18:00:00Z", "2026-09-28T17:30:00Z");
      await assert.rejects(quote(tooLong.slot, undefined, now), /cannot exceed 23 hours/);
      await assert.rejects(createBooking(tooLong, now), /cannot exceed 23 hours/);
      const r = await confirmed(input("2026-09-27T18:00:00Z", "2026-09-28T17:00:00Z"));
      await assert.rejects(guestMutation(r.token, { action: "change", version: r.booking.version, slot: tooLong.slot, termsVersion: TERMS_VERSION }, now), /cannot exceed 23 hours/);
      const during = Date.parse("2026-09-27T19:00:00Z");
      await assert.rejects(guestMutation(r.token, { action: "change", version: r.booking.version, slot: tooLong.slot, termsVersion: TERMS_VERSION }, during), /cannot exceed 23 hours/);
    });
    await t.test("calendar disables fully booked days and restores cancelled or expired availability", async () => {
      await fresh();
      const r = await confirmed(input("2026-09-25T05:00:00Z", "2026-09-26T03:30:00Z"));
      const month = await calendarAvailability("2026-09", now);
      assert.ok(!month.availableDates.includes("2026-09-25"));
      assert.ok(month.availableDates.includes("2026-09-24"));
      assert.ok(month.availableDates.includes("2026-09-26"));
      assert.deepEqual((await availability("2026-09-25", undefined, now)).starts, []);
      assert.deepEqual(Object.keys(month).sort(), ["availableDates", "month", "today"]);
      await guestMutation(r.token, { action: "cancel", version: r.booking.version }, now);
      assert.ok((await calendarAvailability("2026-09", now)).availableDates.includes("2026-09-25"));
      await createBooking(input("2026-09-27T05:00:00Z", "2026-09-28T03:30:00Z"), now);
      assert.ok(!(await calendarAvailability("2026-09", now)).availableDates.includes("2026-09-27"));
      assert.ok((await calendarAvailability("2026-09", now + 48 * 3600000)).availableDates.includes("2026-09-27"));
    });
    await t.test("calendar and time selection agree about today's remaining overnight starts", async () => {
      await fresh();
      await confirmed(input("2026-09-25T01:30:00Z", "2026-09-25T03:30:00Z"));
      const evening = Date.parse("2026-09-25T01:00:00Z");
      const month = await calendarAvailability("2026-09", evening);
      assert.equal(month.today, "2026-09-24");
      assert.ok(!month.availableDates.includes("2026-09-24"));
      assert.ok(month.availableDates.includes("2026-09-25"));
      assert.deepEqual((await availability("2026-09-24", undefined, evening)).starts, []);
      await fresh();
      assert.ok((await calendarAvailability("2026-09", evening)).availableDates.includes("2026-09-24"));
      assert.ok((await availability("2026-09-24", undefined, evening)).starts.length);
    });
    await t.test("database exclusion also rejects a bypass of the application lock", async () => {
      await fresh(); const r = await createBooking(input(), now);
      const id = randomUUID();
      await pool().query("INSERT INTO bookings(id,request_key,request_hash,email,data) VALUES($1,$1,'test','test','{}')", [id]);
      await assert.rejects(pool().query("INSERT INTO studio_occupancy SELECT $1, occupied FROM studio_occupancy WHERE booking_id=$2", [id, r.booking.id]), (e: unknown) => (e as { code: string }).code === "23P01");
    });
    await t.test("retries return the same booking but mismatched payloads fail", async () => {
      await fresh(); const data = input();
      const a = await createBooking(data, now), b = await createBooking(data, now);
      assert.equal(a.booking.id, b.booking.id); assert.equal(a.token, b.token);
      await assert.rejects(createBooking({ ...data, customer: { ...data.customer, artist: "changed" } }, now));
      assert.equal((await pool().query("SELECT count(*) FROM booking_jobs")).rows[0].count, "3");
    });
    await t.test("only Stripe deposits permit approval; manual payment actions are rejected", async () => {
      await fresh(); const r = await createBooking(input(), now), staff = await staffLink(r.booking.id);
      await assert.rejects(guestMutation(r.token, { action: "payment_sent", version: r.booking.version }, now));
      await assert.rejects(staffMutation(staff, { action: "record_deposit", version: r.booking.version, amount: r.booking.pricing.deposit, note: "forged" }, now));
      await assert.rejects(staffMutation(staff, { action: "approve", version: r.booking.version }, now));
      const b = await paid(r);
      assert.equal(b.depositPaid, b.pricing.deposit); assert.equal(b.status, "pending");
      assert.equal((await staffMutation(staff, { action: "approve", version: b.version }, now)).status, "confirmed");
      await assert.rejects(staffMutation(r.token, { action: "decline", version: b.version }, now));
    });
    await t.test("checkout retries reuse the intent, and duplicate success cannot duplicate receipts or jobs", async () => {
      await fresh(); const r = await createBooking(input(), now);
      const calls = created.mock.callCount();
      const results = await Promise.all([prepareDeposit(r.token, now), prepareDeposit(r.token, now)]);
      assert.equal(results[0].clientSecret, results[1].clientSecret);
      assert.equal(created.mock.callCount() - calls, 1);
      const call = created.mock.calls.at(-1)!;
      assert.equal(call.arguments[0].amount, r.booking.pricing.deposit);
      assert.deepEqual(call.arguments[0].payment_method_types, ["card", "cashapp"]);
      const b = await paid(r);
      const before = (await pool().query("SELECT count(*) FROM booking_jobs")).rows[0].count;
      await recordStripeDeposit(intents.get(`pi_${r.booking.id}`)!, now);
      assert.equal((await readBooking(r.token, "guest", now)).version, b.version);
      assert.equal((await pool().query("SELECT count(*) FROM booking_jobs")).rows[0].count, before);
      assert.equal((await prepareDeposit(r.token, now)).status, "succeeded");
    });
    await t.test("wrong amount, currency, intent, mode and private links cannot mark a deposit paid", async () => {
      await fresh(); const r = await createBooking(input(), now);
      await assert.rejects(prepareDeposit(await staffLink(r.booking.id), now));
      await prepareDeposit(r.token, now);
      const intent = { ...intents.get(`pi_${r.booking.id}`)!, status: "succeeded", amount_received: r.booking.pricing.deposit } as Stripe.PaymentIntent;
      for (const change of [{ amount: 1 }, { amount_received: 1 }, { currency: "eur" }, { id: "pi_forged" }, { livemode: true }]) {
        await assert.rejects(recordStripeDeposit({ ...intent, ...change }, now), /does not match/);
      }
      await recordStripeDeposit({ ...intent, status: "requires_payment_method" }, now);
      assert.equal((await readBooking(r.token, "guest", now)).depositPaid, 0);
    });
    await t.test("server retrieval recovers a successful payment before webhook delivery", async () => {
      await fresh(); const r = await createBooking(input(), now);
      await prepareDeposit(r.token, now);
      const intent = intents.get(`pi_${r.booking.id}`)!;
      intent.status = "succeeded"; intent.amount_received = intent.amount;
      await syncDeposit(r.token, now);
      assert.equal((await readBooking(r.token, "guest", now)).depositPaid, r.booking.pricing.deposit);
    });
    await t.test("abandoned checkouts release time after fifteen minutes and cannot resume", async () => {
      await fresh(); const data = input(), r = await createBooking(data, now);
      await prepareDeposit(r.token, now);
      await sweep(now + 15 * 60000);
      assert.equal((await readBooking(r.token, "guest", now + 15 * 60000)).status, "expired");
      await assert.rejects(prepareDeposit(r.token, now + 15 * 60000), /expired/);
      const replacement = await createBooking({ ...data, requestKey: randomUUID() }, now + 15 * 60000);
      assert.equal(replacement.booking.status, "pending");
      const late = await paid(r, now + 15 * 60000);
      assert.equal(late.status, "expired"); assert.equal(late.refundOwed, late.pricing.deposit);
      assert.equal((await pool().query("SELECT booking_id FROM studio_occupancy")).rows[0].booking_id, replacement.booking.id);
    });
    await t.test("a payment after same-day cancellation is fully refundable", async () => {
      await fresh(); const r = await createBooking(input("2026-09-24T14:00:00Z", "2026-09-24T16:00:00Z"), now);
      await prepareDeposit(r.token, now);
      await guestMutation(r.token, { action: "cancel", version: r.booking.version }, now);
      const b = await paid(r, now + 60000);
      assert.equal(b.status, "cancelled"); assert.equal(b.refundOwed, b.pricing.deposit);
    });
    await t.test("buffer applies across rooms and day boundaries", async () => {
      await fresh(); await confirmed(input("2026-09-25T02:00:00Z", "2026-09-25T04:00:00Z"));
      await assert.rejects(createBooking(input("2026-09-25T04:00:00Z", "2026-09-25T06:00:00Z"), now));
      await createBooking(input("2026-09-25T04:30:00Z", "2026-09-25T06:30:00Z"), now);
    });
    await t.test("cancellation at the exact cutoff forfeits the deposit; earlier cancellation refunds", async () => {
      await fresh(); const r = await confirmed(); const cutoff = Date.parse(r.booking.slot.start) - 86400000;
      let b = await guestMutation(r.token, { action: "cancel", version: r.booking.version }, cutoff - 1);
      assert.equal(b.refundOwed, r.booking.depositPaid);
      await fresh(); const second = await confirmed();
      b = await guestMutation(second.token, { action: "cancel", version: second.booking.version }, cutoff);
      assert.equal(b.refundOwed, 0);
      assert.equal((await pool().query("SELECT count(*) FROM studio_occupancy")).rows[0].count, "0");
    });
    await t.test("change holds old and new slots and keeps deposit and rates fixed", async () => {
      await fresh(); const r = await confirmed();
      const slot = { ...r.booking.slot, start: "2026-09-28T14:00:00Z", end: "2026-09-28T16:00:00Z" };
      let b = await guestMutation(r.token, { action: "change", version: r.booking.version, slot, termsVersion: TERMS_VERSION }, now);
      await assert.rejects(createBooking(input(), now)); await assert.rejects(createBooking(input(slot.start, slot.end), now));
      b = await staffMutation(r.staff, { action: "approve_change", version: b.version }, now);
      assert.equal(b.pricing.deposit, r.booking.pricing.deposit); assert.equal(b.pricing.total, 10000);
      assert.equal(b.slot.start, slot.start); await createBooking(input(), now);
    });
    await t.test("nonrefundable status survives moving the session into the future", async () => {
      await fresh(); const r = await confirmed(input("2026-09-25T10:00:00Z", "2026-09-25T14:00:00Z"));
      const slot = { ...r.booking.slot, start: "2026-10-01T14:00:00Z", end: "2026-10-01T18:00:00Z" };
      let b = await guestMutation(r.token, { action: "change", version: r.booking.version, slot, termsVersion: TERMS_VERSION }, now);
      b = await staffMutation(r.staff, { action: "approve_change", version: b.version }, now);
      b = await guestMutation(r.token, { action: "cancel", version: b.version }, now);
      assert.equal(b.refundOwed, 0);
    });
    await t.test("in-session extension has to fit, needs approval, and extends link lifetime", async () => {
      await fresh(); const r = await confirmed(); const during = Date.parse(r.booking.slot.start) + 3600000;
      const slot = { ...r.booking.slot, end: "2026-09-27T19:00:00Z" };
      let b = await guestMutation(r.token, { action: "change", version: r.booking.version, slot, termsVersion: TERMS_VERSION }, during);
      b = await staffMutation(r.staff, { action: "approve_change", version: b.version }, during);
      assert.equal(b.pricing.deposit, r.booking.pricing.deposit);
      assert.equal((await readBooking(r.token, "guest", Date.parse("2026-09-27T18:30:00Z"))).slot.end, slot.end);
      await assert.rejects(readBooking(r.token, "guest", Date.parse(slot.end)));
    });
    await t.test("excess deposit is refunded only after manual completion", async () => {
      await fresh(); const r = await confirmed(input("2026-09-27T14:00:00Z", "2026-09-27T22:00:00Z"));
      const slot = { ...r.booking.slot, end: "2026-09-27T16:00:00Z" };
      let b = await guestMutation(r.token, { action: "change", version: r.booking.version, slot, termsVersion: TERMS_VERSION }, now);
      b = await staffMutation(r.staff, { action: "approve_change", version: b.version }, now);
      assert.equal(b.refundOwed, 0);
      await assert.rejects(staffMutation(r.staff, { action: "complete", version: b.version }, now));
      b = await staffMutation(r.staff, { action: "complete", version: b.version }, Date.parse(slot.end));
      assert.equal(b.refundOwed, 10000);
      b = await staffMutation(r.staff, { action: "record_refund", version: b.version, amount: 10000, note: "Refunded in Stripe" }, Date.parse(slot.end));
      assert.equal(b.refundOwed, 0);
      await assert.rejects(staffMutation(r.staff, { action: "record_refund", version: b.version, amount: 10001, note: "extra" }, Date.parse(slot.end)));
    });
    await t.test("same-day expiry releases time and late Stripe payments remain refundable", async () => {
      await fresh(); const data = input("2026-09-24T14:00:00Z", "2026-09-24T16:00:00Z");
      const r = await createBooking(data, now); assert.equal(r.booking.refundable, false);
      await prepareDeposit(r.token, now);
      await sweep(Date.parse(data.slot.start));
      let b = await readBooking(await staffLink(r.booking.id), "staff", Date.parse(data.slot.start)); assert.equal(b.status, "expired");
      b = await paid(r, Date.parse(data.slot.start));
      assert.equal(b.refundOwed, 5000);
    });
    await t.test("stale versions, forged links, price injection, and wrong terms are rejected", async () => {
      await fresh(); const r = await createBooking(input(), now);
      await assert.rejects(guestMutation(r.token, { action: "cancel", version: r.booking.version + 1 }, now));
      await assert.rejects(readBooking(r.token.slice(0, -2) + "XX", "guest", now));
      await assert.rejects(createBooking({ ...input(), total: 1 }, now));
      await assert.rejects(createBooking({ ...input(), quotedTotal: 1 }, now));
      await assert.rejects(createBooking({ ...input(), termsVersion: "old" }, now));
    });
    await t.test("availability hides identities and recovery does not revoke links", async () => {
      await fresh(); const data = input(); const r = await createBooking(data, now);
      const result = await availability("2026-09-27", undefined, now);
      assert.ok(!JSON.stringify(result).includes(data.customer.email));
      assert.ok(!result.starts.includes("2026-09-27T14:00:00.000Z"));
      assert.equal(result.endsByStart["2026-09-27T04:00:00.000Z"].at(-1), "2026-09-27T13:30:00.000Z");
      assert.ok(result.starts.includes("2026-09-27T18:30:00.000Z"));
      assert.deepEqual(Object.keys(result.endsByStart), result.starts);
      assert.ok(!("ranges" in result));
      const ownAvailability = await availability("2026-09-27", r.token, now);
      assert.equal(ownAvailability.starts.length, 48);
      assert.equal(ownAvailability.endsByStart["2026-09-27T04:00:00.000Z"].at(-1), "2026-09-28T03:00:00.000Z");
      await recover(data.customer.email, now);
      assert.equal((await readBooking(r.token, "guest", now)).id, r.booking.id);
      assert.equal((await pool().query("SELECT (data->>'version')::int AS version FROM bookings")).rows[0].version, r.booking.version);
    });
    await t.test("production booking is blocked until pricing is confirmed", async () => {
      await fresh(); process.env.BOOKING_MODE = "live"; process.env.PRICING_CONFIRMED = "false";
      await assert.rejects(createBooking(input(), now), /confirms pricing/);
      process.env.BOOKING_MODE = "test";
    });
    await t.test("RLS is enabled on all private booking tables without public policies", async () => {
      const { rows } = await pool().query("SELECT relrowsecurity FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname IN ('bookings','studio_occupancy','booking_events','booking_jobs','booking_rate_limits')");
      assert.equal(rows.length, 5); assert.ok(rows.every(r => r.relrowsecurity));
    });
    await t.test("durable delivery retries, deterministic calendar IDs, and provider idempotency", async () => {
      await fresh();
      // Use a real-time future slot because the scheduled worker owns its clock.
      const start = Math.ceil((Date.now() + 86400000) / 1800000) * 1800000;
      const r = await createBooking(input(new Date(start).toISOString(), new Date(start + 14400000).toISOString()), Date.now());
      process.env.EMAIL_MODE = "resend"; process.env.EMAIL_FROM = "studio@example.com"; process.env.STAFF_EMAIL = "owner@example.com";
      process.env.RESEND_API_KEY = "test-only"; process.env.GOOGLE_CLIENT_ID = "test-only"; process.env.GOOGLE_CLIENT_SECRET = "test-only";
      process.env.GOOGLE_REFRESH_TOKEN = "test-only"; process.env.GOOGLE_CALENDAR_ID = "test-calendar";
      const originalFetch = globalThis.fetch;
      const staleProposalId = r.booking.id.replaceAll("-", "") + "b0123456789";
      const seen: { url: string; method: string; key: string | null }[] = []; let failEmail = true;
      globalThis.fetch = async (url, init) => {
        const address = String(url); seen.push({ url: address, method: init?.method ?? "GET", key: new Headers(init?.headers).get("Idempotency-Key") });
        if (address.includes("resend.com") && failEmail) { failEmail = false; return new Response("", { status: 503 }); }
        if (address.includes("oauth2")) return Response.json({ access_token: "test-token" });
        if (address.includes("privateExtendedProperty=")) return Response.json({ items: [{ id: staleProposalId }] });
        if (init?.method === "PUT") return new Response("", { status: 404 });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json({ id: "test-provider-id" });
      };
      try {
        const first = await runJobs(); assert.equal(first.failed, 1); assert.equal(first.processed, 2);
        await pool().query("UPDATE booking_jobs SET available_at=now() WHERE completed_at IS NULL");
        const second = await runJobs(); assert.equal(second.failed, 0); assert.equal(second.processed, 1);
        const guestEmails = seen.filter(s => s.url.includes("resend.com") && s.key === seen[0].key);
        assert.equal(guestEmails.length, 2); assert.ok(guestEmails[0].key);
        assert.ok(seen.some(s => s.url.includes(r.booking.id.replaceAll("-", "") + "a")));
        assert.ok(seen.some(s => s.method === "DELETE" && s.url.includes(staleProposalId)));
        assert.equal((await pool().query("SELECT count(*) FROM booking_jobs WHERE completed_at IS NULL")).rows[0].count, "0");
      } finally { globalThis.fetch = originalFetch; }
    });
  } finally {
    await pool().end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
