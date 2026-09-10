import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKING_SESSION_TTL, BOOKING_TERMS_VERSION, bookingDetails, customerErrors, emptyBookingDraft, hasAcceptedTerms, parseBookingDate, restoreBookingDraft, serializeBookingDraft, updateBookingDraft, type BookingDraft } from "../lib/booking-session.ts";

const now = new Date(2026, 8, 9, 12).getTime();
const expiry = now + BOOKING_SESSION_TTL;
function completeDraft(): BookingDraft {
  const draft = { ...emptyBookingDraft(new Date(now)), step: 6,
    customer: { room: "control" as const, artist: "Test artist", email: "test@example.com", phone: "+1 212 555 0123" },
    date: "2026-09-10", calendarMonth: "2026-09-01", rangeId: "night", start: 1380, end: 1500 };
  return { ...draft, acceptance: { version: BOOKING_TERMS_VERSION, details: bookingDetails(draft) } };
}
function restore(draft: BookingDraft, at = now) {
  return restoreBookingDraft(serializeBookingDraft(draft, expiry), at);
}

test("restores steps and dialogs with consent cleared, preserving completed confirmation", () => {
  for (let step = 0; step <= 7; step++) {
    const draft = { ...completeDraft(), step, reference: step === 7 ? "ELY-12ABCDEF" : "", dialog: step >= 5 ? "terms" as const : "info" as const };
    assert.deepEqual(restore(draft)?.draft, { ...draft, acceptance: null, step: step === 6 ? 5 : step });
  }
});

test("preserves partial inputs, validation intent, and a browsed calendar month", () => {
  const draft = { ...emptyBookingDraft(new Date(now)), step: 1, calendarMonth: "2026-12-01", validationAttempted: true };
  draft.customer.artist = "  unfinished ";
  draft.customer.email = "user@";
  const restored = restore(draft)!.draft;
  assert.deepEqual(restored, draft);
  assert.equal(customerErrors(restored.customer).email, "Enter a valid email address.");
  assert.equal(restore({ ...completeDraft(), step: 2, calendarMonth: "2026-12-01" })!.draft.calendarMonth, "2026-12-01");
});

test("preserves a start time before the end has been chosen", () => {
  const draft = updateBookingDraft(completeDraft(), { step: 4, end: null });
  assert.deepEqual(restore(draft)?.draft, draft);
});

test("expires exactly at 20 minutes; restoration does not renew the deadline", () => {
  assert.equal(restore(completeDraft(), expiry - 1)?.expiresAt, expiry);
  assert.equal(restore(completeDraft(), expiry), null);
  assert.equal(restore(completeDraft(), expiry + 1), null);
});

test("retains consent through navigation but invalidates it for each changed booking detail", () => {
  const draft = completeDraft();
  assert.ok(hasAcceptedTerms(updateBookingDraft(draft, { step: 4, dialog: "terms", calendarMonth: "2026-12-01" })));
  for (const patch of [
    { customer: { ...draft.customer, room: "studio" as const } },
    { customer: { ...draft.customer, artist: "Another artist" } },
    { customer: { ...draft.customer, email: "another@example.com" } },
    { customer: { ...draft.customer, phone: "+1 212 555 9876" } },
    { date: "2026-09-11" }, { rangeId: "day" }, { start: 1410 }, { end: 1530 },
  ]) {
    const changed = updateBookingDraft(draft, patch);
    assert.equal(changed.acceptance, null);
    assert.equal(changed.step, 5);
  }
});

test("consent is never serialized and legacy stored consent is ignored", () => {
  const draft = completeDraft();
  assert.equal(Object.hasOwn(JSON.parse(serializeBookingDraft(draft, expiry)).draft, "acceptance"), false);
  assert.equal(restore(draft)?.draft.step, 5);
  assert.equal(restore(draft)?.draft.acceptance, null);
  const legacy = restoreBookingDraft(JSON.stringify({ version: 1, expiresAt: expiry, draft }), now)!.draft;
  assert.equal(legacy.acceptance, null);
  assert.equal(legacy.step, 5);
  // Saving must not mutate the active page's consent.
  assert.ok(hasAcceptedTerms(draft));
});

test("completed confirmation stays visible without restoring consent", () => {
  const draft = completeDraft();
  const receipt = restore({ ...draft, step: 7, reference: "ELY-12ABCDEF" })!.draft;
  assert.equal(receipt.step, 7);
  assert.equal(receipt.reference, "ELY-12ABCDEF");
  assert.equal(receipt.acceptance, null);
});

test("malformed and unsupported storage fails safely", () => {
  for (const raw of [null, "{", "null", "[]", "{}", JSON.stringify({ version: 2, expiresAt: expiry, draft: completeDraft() }), JSON.stringify({ version: 1, expiresAt: expiry, draft: { customer: null } })]) {
    assert.equal(restoreBookingDraft(raw, now), null);
  }
});

test("invalid prerequisites return to the earliest usable step without losing contact details", () => {
  const draft = completeDraft();
  assert.equal(restore({ ...draft, customer: { ...draft.customer, email: "bad" } })?.draft.step, 1);
  const stale = restore({ ...draft, date: "2026-09-08" })!.draft;
  assert.equal(stale.step, 2);
  assert.deepEqual(stale.customer, draft.customer);
  assert.equal(restore({ ...draft, rangeId: "removed" })?.draft.step, 3);
  assert.equal(restore({ ...draft, end: 1400 })?.draft.step, 4);
  assert.equal(restore({ ...draft, step: 7, reference: "" })?.draft.step, 5);
});

test("date parsing retains local dates and rejects impossible dates", () => {
  const date = parseBookingDate("2026-09-10")!;
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 10);
  assert.equal(date.getHours(), 0);
  assert.equal(parseBookingDate("2026-02-30"), null);
  assert.equal(parseBookingDate("2026-09-10T00:00:00Z"), null);
});
