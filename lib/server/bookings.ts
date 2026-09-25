import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { approvalDeadline, BookingError, cutoff, daySlots, instant, monthDays, price, refundable, RATES, studioDate, TERMS_VERSION, validateSlot, type Room, type Slot } from "../booking-policy.ts";
import { assertBookingEnabled, pricingConfig } from "./config.ts";
import { pool, transaction } from "./db.ts";
import { equal, hash, rateKey, token, tokenId } from "./security.ts";
import { availableTimes, hasAvailableStart } from "../booking-availability.ts";

export const slotSchema = z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), room: z.enum(["control", "studio"]) }).strict();
const customerSchema = z.object({ artist: z.string().trim().min(1).max(80), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), phone: z.string().trim().min(7).max(30).regex(/^[+()\d\s.-]+$/) }).strict();
export const createSchema = z.object({ customer: customerSchema, slot: slotSchema, termsVersion: z.literal(TERMS_VERSION), requestKey: z.string().uuid(), quotedTotal: z.number().int().nonnegative() }).strict();
export type BookingRecord = {
  id: string; reference: string; version: number; customer: z.infer<typeof customerSchema>;
  slot: Slot; proposal: { id: string; slot: Slot; expiresAt: number; termsVersion: string; acceptedAt: number } | null;
  status: "pending" | "confirmed" | "cancelled" | "declined" | "expired" | "completed" | "blocked";
  rates: Record<Room, number>; taxBps: number; depositDue: number;
  depositPaid: number; balancePaid: number; refunded: number;
  stripePaymentIntentId?: string; checkoutExpiresAt?: number;
  nonrefundable: boolean; cancellationRefundable: boolean; approvalBy: number;
  createdAt: number; termsVersion: string; acceptedAt: number;
  nonce: string; guestHash: string; staffHash: string; testMode: boolean;
};
const terminal = (b: BookingRecord) => ["cancelled", "declined", "expired", "completed"].includes(b.status);
export function refundEntitlement(b: BookingRecord) {
  const paid = b.depositPaid + b.balancePaid;
  if (b.status === "declined" || b.status === "expired") return paid;
  if (b.status === "cancelled") return b.cancellationRefundable ? paid : Math.max(0, paid - b.depositDue);
  if (b.status === "completed") return Math.max(0, paid - price(b.slot, b.rates, b.taxBps).total);
  return 0;
}
export function dto(b: BookingRecord, now: number) {
  const pricing = price(b.slot, b.rates, b.taxBps);
  return {
    id: b.id, reference: b.reference, version: b.version, customer: b.customer, slot: b.slot,
    proposal: b.proposal && { ...b.proposal, pricing: price(b.proposal.slot, b.rates, b.taxBps) }, status: b.status,
    pricing: { ...pricing, deposit: b.depositDue }, depositPaid: b.depositPaid, balancePaid: b.balancePaid,
    refunded: b.refunded, refundOwed: Math.max(0, refundEntitlement(b) - b.refunded),
    checkoutExpiresAt: b.checkoutExpiresAt ? new Date(b.checkoutExpiresAt).toISOString() : null,
    balanceOwed: terminal(b) && b.status !== "completed" ? 0 : Math.max(0, pricing.total - b.depositPaid - b.balancePaid + b.refunded),
    cancellationDeadline: new Date(cutoff(b.slot)).toISOString(), refundable: refundable(b.slot, now, b.nonrefundable),
    approvalBy: new Date(b.approvalBy).toISOString(), canModify: !terminal(b) && b.status !== "blocked" && now < instant(b.slot.end).epochMilliseconds,
    now: new Date(now).toISOString(), testMode: b.testMode,
  };
}
export type BookingView = ReturnType<typeof dto>;
export async function load(client: PoolClient, id: string): Promise<BookingRecord> {
  const result = await client.query("SELECT data FROM bookings WHERE id = $1", [id]);
  if (!result.rows[0]) throw new BookingError("Booking not found.", 404);
  return result.rows[0].data;
}
async function available(client: PoolClient, slot: Slot, exclude?: string) {
  const result = await client.query("SELECT 1 FROM studio_occupancy WHERE ($3::uuid IS NULL OR booking_id <> $3) AND occupied && tstzmultirange(tstzrange($1::timestamptz, $2::timestamptz + interval '15 minutes', '[)')) LIMIT 1", [slot.start, slot.end, exclude ?? null]);
  return !result.rowCount;
}
async function requireAvailable(client: PoolClient, slot: Slot, exclude?: string) {
  if (!await available(client, slot, exclude)) throw new BookingError("That time overlaps another reservation or its 15-minute buffer. Choose another time.", 409);
}
export async function save(client: PoolClient, b: BookingRecord, action: string, actor: string) {
  b.version++;
  await client.query("UPDATE bookings SET data = $2 WHERE id = $1", [b.id, JSON.stringify(b)]);
  await client.query("DELETE FROM studio_occupancy WHERE booking_id = $1", [b.id]);
  if (!terminal(b)) {
    const ranges = [b.slot, ...(b.proposal ? [b.proposal.slot] : [])].map(s => `[${s.start},${new Date(instant(s.end).epochMilliseconds + 900000).toISOString()})`);
    await client.query("INSERT INTO studio_occupancy(booking_id, occupied) VALUES ($1, $2::tstzmultirange)", [b.id, `{${ranges.join(",")}}`]);
  }
  const audit = { slot: b.slot, proposal: b.proposal, status: b.status, depositDue: b.depositDue, depositPaid: b.depositPaid, balancePaid: b.balancePaid, refunded: b.refunded, nonrefundable: b.nonrefundable, termsVersion: b.termsVersion, acceptedAt: b.acceptedAt };
  await client.query("INSERT INTO booking_events(booking_id,version,actor,action,metadata) VALUES ($1,$2,$3,$4,$5)", [b.id, b.version, actor, action, JSON.stringify(audit)]);
  const kinds = b.termsVersion === "manual-block" ? ["calendar"] : ["email_guest", "email_staff", "calendar"];
  for (const kind of kinds) await client.query("INSERT INTO booking_jobs(booking_id,version,kind,message) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [b.id, b.version, kind, action]);
}
export async function expire(client: PoolClient, now: number) {
  const rows = await client.query("SELECT data FROM bookings WHERE data->>'status' = 'pending' OR data->'proposal' <> 'null'::jsonb");
  for (const { data: b } of rows.rows as { data: BookingRecord }[]) {
    if (b.status === "pending" && (b.approvalBy <= now || (b.depositPaid < b.depositDue && b.checkoutExpiresAt !== undefined && b.checkoutExpiresAt <= now))) {
      b.status = "expired"; b.proposal = null;
      await save(client, b, "Request expired. Any payment received must be returned manually.", "system");
    } else if (b.proposal && b.proposal.expiresAt <= now) {
      b.proposal = null;
      await save(client, b, "Change request expired; the original reservation remains unchanged.", "system");
    }
  }
}
export async function rateLimit(client: PoolClient, scope: string, limit: number, now: number) {
  const key = rateKey(scope), start = new Date(Math.floor(now / 3600000) * 3600000);
  const { rows } = await client.query("INSERT INTO booking_rate_limits(key, window_start, count) VALUES ($1,$2,1) ON CONFLICT(key) DO UPDATE SET window_start = EXCLUDED.window_start, count = CASE WHEN booking_rate_limits.window_start = EXCLUDED.window_start THEN booking_rate_limits.count + 1 ELSE 1 END RETURNING count", [key, start]);
  if (rows[0].count > limit) throw new BookingError("Too many requests. Please try again later or contact the studio.", 429);
}
// Run cleanup separately so an invalid request cannot roll expiry back.
export async function sweep(now = Date.now()) { await transaction(c => expire(c, now)); }
export async function authorize(client: PoolClient, credential: string, role: "guest" | "staff", now: number) {
  const b = await load(client, tokenId(credential));
  if (!equal(hash(credential), role === "guest" ? b.guestHash : b.staffHash)) throw new BookingError("This private link is invalid or has expired.", 401);
  const until = instant(b.slot.end).epochMilliseconds + (role === "staff" ? 90 * 86400000 : 0);
  if (now >= until) throw new BookingError("This private link has expired. Contact the studio for help.", 401);
  return b;
}
export async function readBooking(credential: string, role: "guest" | "staff", now = Date.now()) {
  await sweep(now);
  return transaction(async c => dto(await authorize(c, credential, role, now), now));
}
async function occupiedTimes(c: PoolClient, now: number, exclude?: string) {
  const { rows } = await c.query("SELECT lower(part) AS start, upper(part) AS end FROM studio_occupancy CROSS JOIN LATERAL unnest(occupied) AS part WHERE ($1::uuid IS NULL OR booking_id <> $1) AND upper(part) > $2::timestamptz ORDER BY lower(part)", [exclude ?? null, new Date(now).toISOString()]);
  return rows.map(row => ({ start: row.start.toISOString(), end: row.end.toISOString() }));
}
export async function calendarAvailability(month: string, now = Date.now()) {
  const days = monthDays(month, now);
  await sweep(now);
  return transaction(async c => {
    const occupied = await occupiedTimes(c, now);
    return { month, today: studioDate(now), availableDates: days.filter(day => hasAvailableStart(daySlots(day, now), occupied)) };
  });
}
export async function availability(day: string, credential?: string, now = Date.now()) {
  const slots = daySlots(day, now);
  await sweep(now);
  return transaction(async c => {
    const b = credential ? await authorize(c, credential, "guest", now) : undefined;
    const times = availableTimes(slots, await occupiedTimes(c, now, b?.id));
    return { ...times, timezone: "America/New_York", pricingReady: pricingConfig().ready, testMode: process.env.BOOKING_MODE === "test" };
  });
}
export async function quote(input: unknown, credential?: string, now = Date.now()) {
  const slot = slotSchema.parse(input);
  await sweep(now);
  return transaction(async c => {
    const b = credential ? await authorize(c, credential, "guest", now) : undefined;
    validateSlot(slot, now, b?.slot);
    await requireAvailable(c, slot, b?.id);
    const pricing = price(slot, b?.rates ?? RATES, b?.taxBps ?? pricingConfig().taxBps);
    return { ...pricing, deposit: b?.depositDue ?? pricing.deposit, pricingReady: pricingConfig().ready, testMode: process.env.BOOKING_MODE === "test", termsVersion: TERMS_VERSION };
  });
}
export async function createBooking(input: unknown, now = Date.now()) {
  assertBookingEnabled();
  const data = createSchema.parse(input), requestHash = hash(JSON.stringify(data));
  validateSlot(data.slot, now);
  await sweep(now);
  return transaction(async c => {
    const existing = await c.query("SELECT data, request_hash FROM bookings WHERE request_key = $1", [data.requestKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new BookingError("This request changed. Please refresh and submit again.", 409);
      const b: BookingRecord = existing.rows[0].data;
      return { booking: dto(b, now), token: token(b.id, b.nonce, "guest") };
    }
    await rateLimit(c, "create:global", 100, now);
    await rateLimit(c, `create:${data.customer.email}`, 5, now);
    await requireAvailable(c, data.slot);
    const id = randomUUID(), nonce = randomUUID(), taxBps = pricingConfig().taxBps;
    if (data.quotedTotal !== price(data.slot, RATES, taxBps).total) throw new BookingError("Pricing has changed. Review a fresh quote before submitting.", 409);
    const guestToken = token(id, nonce, "guest"), staffToken = token(id, nonce, "staff");
    const b: BookingRecord = {
      id, reference: `ELY-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`, version: 0, customer: data.customer,
      slot: data.slot, proposal: null, status: "pending", rates: { ...RATES }, taxBps,
      depositDue: price(data.slot, RATES, taxBps).deposit, depositPaid: 0, balancePaid: 0, refunded: 0,
      checkoutExpiresAt: Math.min(now + 15 * 60000, approvalDeadline(data.slot, now)),
      nonrefundable: now >= cutoff(data.slot), cancellationRefundable: false,
      approvalBy: approvalDeadline(data.slot, now), createdAt: now, termsVersion: data.termsVersion, acceptedAt: now,
      nonce, guestHash: hash(guestToken), staffHash: hash(staffToken), testMode: process.env.BOOKING_MODE === "test",
    };
    await c.query("INSERT INTO bookings(id, request_key, request_hash, email, data) VALUES ($1,$2,$3,$4,$5)", [id, data.requestKey, requestHash, b.customer.email, JSON.stringify(b)]);
    await save(c, b, "Checkout started. Pay the deposit through Stripe within 15 minutes; studio approval follows payment.", "guest");
    return { booking: dto(b, now), token: guestToken };
  });
}
const guestAction = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["cancel", "withdraw_change"]), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("change"), version: z.number().int().positive(), slot: slotSchema, termsVersion: z.literal(TERMS_VERSION) }).strict(),
]);
export async function guestMutation(credential: string, input: unknown, now = Date.now()) {
  const action = guestAction.parse(input);
  await sweep(now);
  return transaction(async c => {
    const b = await authorize(c, credential, "guest", now);
    if (b.version !== action.version) throw new BookingError("This booking has changed. Refresh before continuing.", 409);
    if (terminal(b) || b.status === "blocked") throw new BookingError("This reservation can no longer be changed.", 409);
    await rateLimit(c, `manage:${b.id}`, 30, now);
    b.nonrefundable ||= now >= cutoff(b.slot);
    let message = "";
    if (action.action === "cancel") {
      if (now >= instant(b.slot.start).epochMilliseconds) throw new BookingError("Your session has started. Contact the studio to end it early.");
      b.cancellationRefundable = refundable(b.slot, now, b.nonrefundable);
      b.status = "cancelled"; b.proposal = null;
      message = b.cancellationRefundable ? "Artist cancelled. Any refund owed will be handled manually." : "Artist cancelled after the refund deadline. The deposit is nonrefundable.";
    } else if (action.action === "withdraw_change") {
      if (!b.proposal) throw new BookingError("No change is awaiting approval.");
      b.proposal = null; message = "Artist withdrew their change request.";
    } else if (action.action === "change") {
      validateSlot(action.slot, now, b.slot);
      if (JSON.stringify(action.slot) === JSON.stringify(b.slot)) throw new BookingError("Choose a different time or room.");
      await requireAvailable(c, action.slot, b.id);
      const started = now >= instant(b.slot.start).epochMilliseconds;
      b.proposal = { id: randomUUID(), slot: action.slot, termsVersion: action.termsVersion, acceptedAt: now, expiresAt: Math.min(now + 48 * 3600000, started ? instant(b.slot.end).epochMilliseconds : Math.min(instant(b.slot.start).epochMilliseconds, instant(action.slot.start).epochMilliseconds)) };
      message = "Artist requested a booking change. The original session remains reserved until approval.";
    }
    await save(c, b, message, "guest");
    return dto(b, now);
  });
}
export const staffAction = z.object({ action: z.enum(["approve", "decline", "approve_change", "decline_change", "complete", "record_balance", "record_refund"]), version: z.number().int().positive(), amount: z.number().int().min(0).max(100000000).optional(), note: z.string().trim().max(300).optional() }).strict();
export async function staffMutation(credential: string, input: unknown, now = Date.now()) {
  const action = staffAction.parse(input);
  await sweep(now);
  return transaction(async c => {
    const b = await authorize(c, credential, "staff", now);
    if (b.version !== action.version) throw new BookingError("This booking has changed. Refresh before continuing.", 409);
    b.nonrefundable ||= now >= cutoff(b.slot);
    if (action.action === "record_balance" || action.action === "record_refund") {
      if (action.amount === undefined || !action.note) throw new BookingError("Enter the cumulative amount and a payment reference or verification note.");
      const field = action.action === "record_balance" ? "balancePaid" : "refunded";
      if (action.amount <= b[field]) throw new BookingError("The cumulative amount must increase; already recorded payments are unchanged.");
      if (field === "refunded" && action.amount > refundEntitlement(b)) throw new BookingError("That exceeds the refund currently owed.");
      b[field] = action.amount;
    } else if (action.action === "approve") {
      if (b.status !== "pending" || b.approvalBy <= now) throw new BookingError("This request is no longer awaiting approval.");
      if (b.depositPaid < b.depositDue) throw new BookingError("Verify the full deposit before approval.");
      if (b.proposal) throw new BookingError("Approve or decline the requested change first.");
      await requireAvailable(c, b.slot, b.id); b.status = "confirmed";
    } else if (action.action === "approve_change") {
      if (!b.proposal || b.proposal.expiresAt <= now || terminal(b)) throw new BookingError("No active change request.");
      if (b.depositPaid < b.depositDue) throw new BookingError("Verify the original deposit before approval.");
      validateSlot(b.proposal.slot, now, b.slot);
      await requireAvailable(c, b.proposal.slot, b.id);
      b.slot = b.proposal.slot; b.proposal = null; b.status = "confirmed";
      b.nonrefundable ||= now >= cutoff(b.slot);
    } else if (action.action === "decline_change") {
      if (!b.proposal) throw new BookingError("No active change request.");
      b.proposal = null;
    } else if (action.action === "decline") {
      if (terminal(b)) throw new BookingError("This booking is already closed.");
      b.status = "declined"; b.proposal = null;
    } else if (action.action === "complete") {
      if (b.status !== "confirmed" || now < instant(b.slot.end).epochMilliseconds) throw new BookingError("Only a confirmed session that has ended can be marked completed.");
      b.status = "completed"; b.proposal = null;
    }
    const message = `${action.action.replaceAll("_", " ")}${action.amount !== undefined ? `: cumulative $${(action.amount / 100).toFixed(2)}` : ""}${action.note ? ` — ${action.note}` : ""}`;
    await save(c, b, message, "staff");
    return dto(b, now);
  });
}
export async function recover(email: string, now = Date.now()) {
  const parsed = z.string().trim().email().max(254).parse(email).toLowerCase();
  await sweep(now);
  await transaction(async c => {
    await rateLimit(c, "recover:global", 100, now); await rateLimit(c, `recover:${parsed}`, 3, now);
    const { rows } = await c.query("SELECT data FROM bookings WHERE email = $1 AND (data->'slot'->>'end')::timestamptz > $2 ORDER BY created_at DESC LIMIT 20", [parsed, new Date(now)]);
    for (const { data: b } of rows as { data: BookingRecord }[]) {
      // Resend the same private link; unverified recovery requests cannot revoke access.
      await c.query("INSERT INTO booking_jobs(booking_id,version,kind,message) VALUES ($1,$2,'email_guest','Your requested booking management link.') ON CONFLICT DO NOTHING", [b.id, -Math.floor(now / 3600000)]);
    }
  });
}
export async function staffLink(id: string) {
  const { rows } = await pool().query("SELECT data FROM bookings WHERE id = $1", [id]);
  if (!rows[0]) throw new BookingError("Booking not found.", 404);
  const b: BookingRecord = rows[0].data;
  return token(b.id, b.nonce, "staff");
}
