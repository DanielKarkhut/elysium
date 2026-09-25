import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalDeadline, cutoff, daySlots, horizon, monthDays, price, refundable, RATES, validateSlot, type Slot } from "../lib/booking-policy.ts";
const slot: Slot = { start: "2026-09-26T14:00:00Z", end: "2026-09-26T16:00:00Z", room: "control" };
test("refund boundary is nonrefundable at exactly 24 hours, including same-day requests", () => {
  assert.equal(refundable(slot, cutoff(slot) - 1, false), true);
  assert.equal(refundable(slot, cutoff(slot), false), false);
  assert.equal(refundable(slot, Date.parse(slot.start) - 3600000, false), false);
  assert.equal(refundable(slot, cutoff(slot) - 10000, true), false);
});
test("calendar horizon clamps month ends and supports same-day bookings", () => {
  assert.equal(new Date(horizon(Date.parse("2027-01-31T17:00:00Z"))).toISOString(), "2027-04-30T16:00:00.000Z");
  assert.equal(validateSlot(slot, Date.parse(slot.start) - 1), 120);
  assert.throws(() => validateSlot(slot, Date.parse(slot.start)));
  assert.equal(approvalDeadline(slot, Date.parse(slot.start) - 1000), Date.parse(slot.start));
});
test("DST days expose the right real instants, including both repeated fall hours", () => {
  const spring = daySlots("2027-03-14", Date.parse("2027-03-01T00:00:00Z"));
  const fall = daySlots("2026-11-01", Date.parse("2026-10-01T00:00:00Z"));
  assert.equal(spring.length, 46); assert.equal(fall.length, 50);
  assert.ok(fall.includes("2026-11-01T05:30:00.000Z")); assert.ok(fall.includes("2026-11-01T06:30:00.000Z"));
});
test("two-hour minimum, half-hour increments, and a 23-hour maximum", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.throws(() => validateSlot({ ...slot, end: "2026-09-26T15:30:00Z" }, now));
  assert.throws(() => validateSlot({ ...slot, start: "2026-09-26T14:15:00Z" }, now));
  assert.equal(validateSlot({ ...slot, end: "2026-09-27T13:00:00Z" }, now), 1380);
  assert.throws(() => validateSlot({ ...slot, end: "2026-09-27T13:30:00Z" }, now), /cannot exceed 23 hours/);
  assert.throws(() => validateSlot({ ...slot, end: "2026-10-26T16:00:00Z" }, now), /cannot exceed 23 hours/);
  assert.deepEqual(price(slot, RATES, 0), { subtotal: 10000, tax: 0, total: 10000, deposit: 5000 });
  assert.equal(price({ ...slot, room: "studio" }, RATES, 887.5).tax, 1775);
});
test("in-session edits only extend the original interval", () => {
  const now = Date.parse("2026-09-26T15:00:00Z");
  validateSlot({ ...slot, end: "2026-09-26T17:00:00Z" }, now, slot);
  validateSlot({ ...slot, end: "2026-09-27T13:00:00Z" }, now, slot);
  assert.throws(() => validateSlot({ ...slot, end: "2026-09-27T13:30:00Z" }, now, slot), /cannot exceed 23 hours/);
  assert.throws(() => validateSlot({ ...slot, room: "studio", end: "2026-09-26T17:00:00Z" }, now, slot));
  assert.throws(() => validateSlot(slot, now, slot));
  assert.throws(() => validateSlot({ ...slot, end: "2026-09-26T17:00:00Z" }, Date.parse(slot.end), slot));
});

test("calendar months use New York today, the booking horizon, and month-end clamping", () => {
  const evening = Date.parse("2026-09-25T01:00:00Z");
  assert.equal(monthDays("2026-09", evening)[0], "2026-09-24");
  assert.equal(monthDays("2026-09", evening).at(-1), "2026-09-30");
  assert.equal(monthDays("2026-12", evening).at(-1), "2026-12-24");
  assert.deepEqual(monthDays("2026-08", evening), []);
  assert.deepEqual(monthDays("2027-01", evening), []);
  assert.equal(monthDays("2027-04", Date.parse("2027-01-31T17:00:00Z")).at(-1), "2027-04-30");
  assert.equal(monthDays("2026-09", Date.parse("2026-09-25T04:00:00Z"))[0], "2026-09-25");
  for (const month of ["", "2026-13", "2026-9", "2026-09-01", "not-a-month"]) assert.throws(() => monthDays(month, evening), /valid month/);
});
