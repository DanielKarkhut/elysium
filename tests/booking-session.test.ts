import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { BOOKING_SESSION_TTL, emptyBookingDraft, restoreBookingDraft, serializeBookingDraft, updateBookingDraft } from "../lib/booking-session.ts";
const now = Date.parse("2026-09-24T12:00:00Z");
test("refresh keeps inputs and request key but clears consent and requotes", () => {
  const draft = { ...emptyBookingDraft(new Date(now)), step: 5, accepted: true, requestKey: randomUUID(), start: "2026-09-25T14:00:00Z", duration: "3.5" };
  draft.customer.artist = "Unfinished";
  const result = restoreBookingDraft(serializeBookingDraft(draft, now + BOOKING_SESSION_TTL), now)!;
  assert.equal(result.draft.customer.artist, "Unfinished");
  assert.equal(result.draft.accepted, false); assert.equal(result.draft.step, 2);
  assert.equal(result.draft.requestKey, draft.requestKey);
  assert.equal(result.expiresAt, now + BOOKING_SESSION_TTL);
});
test("expiry, corrupt records, and old demo confirmations cannot become real bookings", () => {
  const draft = emptyBookingDraft(new Date(now));
  const raw = serializeBookingDraft(draft, now + BOOKING_SESSION_TTL);
  assert.ok(restoreBookingDraft(raw, now + BOOKING_SESSION_TTL - 1));
  assert.equal(restoreBookingDraft(raw, now + BOOKING_SESSION_TTL), null);
  assert.equal(restoreBookingDraft("{", now), null);
  assert.equal(restoreBookingDraft(JSON.stringify({ version: 1, expiresAt: now + 1000, draft: { ...draft, reference: "ELY-12345678" } }), now), null);
});
test("changing details revokes consent and resets idempotency while navigation does not", () => {
  const draft = { ...emptyBookingDraft(new Date(now)), accepted: true, requestKey: randomUUID() };
  assert.equal(updateBookingDraft(draft, { step: 2 }).requestKey, draft.requestKey);
  const changed = updateBookingDraft(draft, { duration: "4" });
  assert.equal(changed.accepted, false); assert.equal(changed.requestKey, "");
});
test("refresh retains the private checkout link to resume an already reserved session", () => {
  const draft = { ...emptyBookingDraft(new Date(now)), checkoutToken: "private-checkout-token", step: 4, accepted: true };
  const result = restoreBookingDraft(serializeBookingDraft(draft, now + BOOKING_SESSION_TTL), now)!;
  assert.equal(result.draft.checkoutToken, draft.checkoutToken);
  assert.equal(result.draft.accepted, false);
});
