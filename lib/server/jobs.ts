import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { baseUrl, required } from "./config.ts";
import { pool } from "./db.ts";
import { dto, sweep, type BookingRecord } from "./bookings.ts";
import { token } from "./security.ts";
import { displayTime, instant, type Slot } from "../booking-policy.ts";

type Job = { id: string; booking_id: string; version: number; kind: string; message: string; attempts: number };
async function checkedFetch(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response;
}
function money(n: number) { return `$${(n / 100).toFixed(2)}`; }
async function email(job: Job, b: BookingRecord) {
  const staff = job.kind === "email_staff", view = dto(b, Date.now());
  const role = staff ? "staff" : "guest";
  const link = `${baseUrl()}/${staff ? "staff" : "manage"}#${token(b.id, b.nonce, role)}`;
  const active = ["pending", "confirmed"].includes(b.status) && instant(b.slot.end).epochMilliseconds > Date.now();
  const text = [
    `Elysium ${b.reference} — ${b.status}`,
    `Artist: ${b.customer.artist}`,
    `${b.slot.room === "control" ? "Control room" : "Full studio"}: ${displayTime(b.slot.start)} to ${displayTime(b.slot.end)}`,
    `Session total: ${money(view.pricing.total)}. Original deposit: ${money(b.depositDue)}. Verified deposit: ${money(b.depositPaid)}. Balance owed: ${money(view.balanceOwed)}. Refund owed: ${money(view.refundOwed)}.`,
    b.status === "pending" ? `Your request is not confirmed. ${b.depositPaid >= b.depositDue ? "Your deposit is paid; the studio will review your request." : "Complete your deposit through Stripe using your private booking link."} Approval is due by ${displayTime(new Date(b.approvalBy).toISOString())}.` : "",
    b.proposal ? `A change is awaiting approval: ${displayTime(b.proposal.slot.start)} to ${displayTime(b.proposal.slot.end)}. The original session remains in place.` : "",
    `For artist cancellations, the deposit becomes nonrefundable at ${displayTime(view.cancellationDeadline)}. Once nonrefundable, rescheduling does not reset it.`,
    staff ? `Staff update: ${job.message}` : "Deposits are processed securely through Stripe. The studio handles remaining balances and refunds.",
    staff || active ? `Private ${staff ? "review" : "booking management"} link: ${link}\nKeep this link private. ${staff ? "" : "It works until your session ends."}` : "For help with a closed booking or refund, contact the studio.",
    b.testMode ? "TEST CHECKOUT — NO REAL MONEY IS CHARGED." : "",
  ].filter(Boolean).join("\n\n");
  const to = staff ? required("STAFF_EMAIL").split(",").map(s => s.trim()) : [b.customer.email];
  const payload = { from: required("EMAIL_FROM"), to, subject: `Elysium ${b.reference}: ${b.status}${b.proposal ? " — change requested" : ""}`, text };
  if (process.env.EMAIL_MODE === "file" && process.env.BOOKING_MODE === "test") {
    const directory = join(process.cwd(), ".local", "mail");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${job.id}.json`), JSON.stringify(payload, null, 2), { mode: 0o600 });
  } else {
    await checkedFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${required("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `booking-email-${job.id}` }, body: JSON.stringify(payload) });
  }
}
async function calendar(b: BookingRecord) {
  const authResponse = await checkedFetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: required("GOOGLE_CLIENT_ID"), client_secret: required("GOOGLE_CLIENT_SECRET"), refresh_token: required("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token" }),
  });
  const { access_token } = await authResponse.json();
  const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(required("GOOGLE_CALENDAR_ID"))}/events`;
  const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
  const prefix = b.id.replaceAll("-", ""), mainId = `${prefix}a`;
  const proposalId = b.proposal ? `${prefix}b${(b.proposal.id ?? String(b.proposal.acceptedAt)).replaceAll("-", "")}` : null;
  async function sync(id: string, slot: Slot | null, pending: boolean) {
    if (!slot) {
      const response = await fetch(`${root}/${id}?sendUpdates=none`, { method: "DELETE", headers, signal: AbortSignal.timeout(5000) });
      if (![200, 204, 404, 410].includes(response.status)) throw new Error(`Calendar returned HTTP ${response.status}`);
      return;
    }
    const event = { summary: `${pending ? "PENDING" : b.status === "blocked" ? "BLOCKED" : "CONFIRMED"} · Elysium ${b.reference}`,
      description: `Studio reservation. ${slot.room === "control" ? "Control room" : "Full studio"}. Includes 15 minutes of cleanup after the session. Manage bookings through Elysium; calendar edits do not update availability.`,
      start: { dateTime: slot.start, timeZone: "America/New_York" }, end: { dateTime: new Date(instant(slot.end).epochMilliseconds + 900000).toISOString(), timeZone: "America/New_York" },
      transparency: "opaque", status: pending ? "tentative" : "confirmed", extendedProperties: { private: { elysiumBookingId: b.id } } };
    const response = await fetch(`${root}/${id}?sendUpdates=none`, { method: "PUT", headers, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) });
    if (response.status === 404) {
      const inserted = await fetch(`${root}?sendUpdates=none`, { method: "POST", headers, body: JSON.stringify({ ...event, id }), signal: AbortSignal.timeout(5000) });
      if (!inserted.ok) throw new Error(`Calendar returned HTTP ${inserted.status}`);
    } else if (!response.ok) throw new Error(`Calendar returned HTTP ${response.status}`);
  }
  const active = ["pending", "confirmed", "completed", "blocked"].includes(b.status);
  // A new proposal gets a new event ID: Google retains tombstones for deleted
  // events, so reusing an old proposal ID can fail to recreate a visible event.
  const listed = await checkedFetch(`${root}?privateExtendedProperty=${encodeURIComponent(`elysiumBookingId=${b.id}`)}&maxResults=50`, { headers });
  const existing = await listed.json();
  const stale = (existing.items ?? []).filter((event: { id: string }) => event.id.startsWith(`${prefix}b`) && event.id !== proposalId);
  for (const event of stale.slice(0, 3)) await sync(event.id, null, false);
  if (stale.length > 3 || existing.nextPageToken) throw new Error("Calendar cleanup will continue on retry");
  await sync(mainId, active ? b.slot : null, b.status === "pending");
  if (b.proposal && proposalId) await sync(proposalId, b.proposal.slot, true);
}
export async function runJobs(limit = 10) {
  const started = Date.now();
  await sweep();
  const client = await pool().connect();
  let locked = false, processed = 0, failed = 0;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(724019262) AS locked")).rows[0].locked;
    if (!locked) return { processed, failed, busy: true };
    const { rows: jobs } = await client.query("SELECT * FROM booking_jobs WHERE completed_at IS NULL AND available_at <= now() ORDER BY id LIMIT $1", [limit]);
    for (const job of jobs as Job[]) {
      if (Date.now() - started > 10000) break; // Leave time for a bounded provider call on serverless hosts.
      const { rows } = await client.query("SELECT data FROM bookings WHERE id=$1", [job.booking_id]);
      const b: BookingRecord = rows[0].data;
      try {
        // Old calendar jobs are superseded by the latest version's durable job.
        if (job.kind !== "calendar" || job.version === b.version) {
          if (job.kind === "calendar") await calendar(b); else await email(job, b);
        }
        await client.query("UPDATE booking_jobs SET completed_at=now(), last_error=NULL WHERE id=$1", [job.id]);
        processed++;
      } catch {
        // Never persist credentials, provider response bodies, or private URLs in logs.
        await client.query("UPDATE booking_jobs SET attempts=attempts+1, available_at=now() + ($2 * interval '1 second'), last_error='Delivery failed. Check provider credentials and connectivity.' WHERE id=$1", [job.id, Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7))]);
        failed++;
      }
    }
    await client.query("DELETE FROM booking_rate_limits WHERE window_start < now() - interval '2 days'");
    return { processed, failed, busy: false };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(724019262)");
    client.release();
  }
}
