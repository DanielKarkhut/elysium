import assert from "node:assert/strict";
import { test } from "node:test";
import { availableTimes, hasAvailableStart, timeOptionLabel } from "../lib/booking-availability.ts";
import { daySlots, studioDate, validateSlot } from "../lib/booking-policy.ts";

const now = Date.parse("2026-09-24T12:00:00Z");
test("a 2pm start offers half-hour ends from 4pm through 1pm the next day", () => {
  const starts = daySlots("2026-09-09", Date.parse("2026-09-01T12:00:00Z"));
  const result = availableTimes(starts, []);
  assert.deepEqual(result.starts, starts);
  assert.equal(result.starts.length, 48);
  assert.ok(result.starts.every(start => studioDate(Date.parse(start)) === "2026-09-09"));
  const options = result.endsByStart["2026-09-09T18:00:00.000Z"];
  assert.equal(options[0], "2026-09-09T20:00:00.000Z");
  assert.equal(options.at(-1), "2026-09-10T17:00:00.000Z");
  assert.equal(options.length, 43);
  assert.ok(options.every((end, i) => Date.parse(end) === Date.parse(options[0]) + i * 1800000));
});
test("midnight and late-night starts each get their own 23-hour limit", () => {
  const result = availableTimes(daySlots("2026-09-25", now), []);
  assert.equal(result.endsByStart["2026-09-25T04:00:00.000Z"].at(-1), "2026-09-26T03:00:00.000Z");
  const late = result.endsByStart["2026-09-26T03:30:00.000Z"];
  assert.equal(late[0], "2026-09-26T05:30:00.000Z");
  assert.equal(late.at(-1), "2026-09-27T02:30:00.000Z");
  assert.match(timeOptionLabel(late.at(-1)!, "2026-09-25"), /10:30 PM EDT \(2026-09-26\)/);
});
test("occupancy and cleanup shorten end choices without jumping across bookings", () => {
  const result = availableTimes(daySlots("2026-09-26", now), [
    { start: "2026-09-26T19:15:00Z", end: "2026-09-26T21:30:00Z" },
    { start: "2026-09-27T00:15:00Z", end: "2026-09-27T01:00:00Z" },
    { start: "2026-09-27T06:15:00Z", end: "2026-09-27T08:00:00Z" },
  ]);
  assert.equal(result.endsByStart["2026-09-26T04:00:00.000Z"].at(-1), "2026-09-26T19:00:00.000Z");
  assert.deepEqual(result.endsByStart["2026-09-26T17:00:00.000Z"], ["2026-09-26T19:00:00.000Z"]);
  assert.ok(!result.starts.includes("2026-09-26T17:30:00.000Z"));
  assert.equal(result.endsByStart["2026-09-26T21:30:00.000Z"].at(-1), "2026-09-27T00:00:00.000Z");
  assert.equal(result.endsByStart["2026-09-27T01:00:00.000Z"].at(-1), "2026-09-27T06:00:00.000Z");
  const aligned = availableTimes(["2026-09-26T14:00:00.000Z"], [{ start: "2026-09-26T19:00:00Z", end: "2026-09-26T21:15:00Z" }]);
  assert.equal(aligned.endsByStart[aligned.starts[0]].at(-1), "2026-09-26T18:30:00.000Z");
});
test("overlapping occupancy and fully booked days expose no invalid starts", () => {
  assert.deepEqual(availableTimes(daySlots("2026-09-26", now), [
    { start: "2026-09-25T00:00:00Z", end: "2026-09-28T00:00:00Z" },
    { start: "2026-09-26T14:00:00Z", end: "2026-09-26T16:00:00Z" },
  ]), { starts: [], endsByStart: {} });
  assert.deepEqual(availableTimes([], []), { starts: [], endsByStart: {} });
});
test("same-day starts exclude elapsed times and can continue overnight", () => {
  const current = Date.parse("2026-09-25T22:00:00Z");
  const result = availableTimes(daySlots("2026-09-25", current), []);
  assert.equal(result.starts[0], "2026-09-25T22:30:00.000Z");
  assert.ok(result.starts.every(start => Date.parse(start) > current && studioDate(Date.parse(start)) === "2026-09-25"));
  assert.equal(result.endsByStart[result.starts[0]].at(-1), "2026-09-26T21:30:00.000Z");
});
test("DST end options use 23 elapsed hours and distinguish repeated fall hours", () => {
  for (const [day, current] of [["2027-03-13", "2027-03-01T00:00:00Z"], ["2026-10-31", "2026-10-01T00:00:00Z"]]) {
    const instant = Date.parse(current);
    const result = availableTimes(daySlots(day, instant), []);
    for (const start of result.starts) {
      const options = result.endsByStart[start];
      assert.equal(options.length, 43);
      assert.equal(Date.parse(options.at(-1)!) - Date.parse(start), 23 * 3600000);
      for (const end of options) validateSlot({ start, end, room: "control" }, instant);
    }
  }
  const spring = availableTimes(["2027-03-14T03:00:00.000Z"], []).endsByStart["2027-03-14T03:00:00.000Z"];
  assert.ok(!spring.some(end => /^2:\d{2} AM/.test(timeOptionLabel(end, "2027-03-13"))));
  const fall = availableTimes(["2026-11-01T02:00:00.000Z"], []).endsByStart["2026-11-01T02:00:00.000Z"];
  assert.ok(fall.includes("2026-11-01T05:30:00.000Z"));
  assert.ok(fall.includes("2026-11-01T06:30:00.000Z"));
  assert.match(timeOptionLabel("2026-11-01T05:30:00Z", "2026-10-31"), /1:30 AM EDT/);
  assert.match(timeOptionLabel("2026-11-01T06:30:00Z", "2026-10-31"), /1:30 AM EST/);
});

test("late-night availability allows overnight sessions but respects today's occupied starts", () => {
  const current = Date.parse("2026-09-25T01:00:00Z"); // Sep 24, 9pm New York.
  const starts = daySlots("2026-09-24", current);
  assert.ok(hasAvailableStart(starts, []));
  const occupied = [{ start: "2026-09-25T01:30:00Z", end: "2026-09-25T03:45:00Z" }];
  assert.equal(hasAvailableStart(starts, occupied), false);
  assert.equal(availableTimes(starts, occupied).starts.length, 0);
  assert.ok(hasAvailableStart(daySlots("2026-09-25", current), occupied));
  // With 15 minutes of cleanup already included, 11:30pm can start after 11:15pm.
  const earlierEnd = [{ ...occupied[0], end: "2026-09-25T03:15:00Z" }];
  assert.ok(hasAvailableStart(starts, earlierEnd));
  assert.deepEqual(availableTimes(starts, earlierEnd).starts, ["2026-09-25T03:30:00.000Z"]);
  assert.equal(hasAvailableStart(daySlots("2026-09-24", Date.parse("2026-09-25T03:30:00Z")), []), false);
});
test("calendar availability agrees with end options, including cleanup at the two-hour boundary", () => {
  const start = "2026-09-25T18:00:00.000Z";
  for (const next of ["2026-09-25T20:00:00Z", "2026-09-25T20:14:00Z", "2026-09-25T20:15:00Z"]) {
    const occupied = [{ start: next, end: "2026-09-25T23:00:00Z" }];
    assert.equal(hasAvailableStart([start], occupied), next.endsWith("20:15:00Z"));
    assert.equal(hasAvailableStart([start], occupied), availableTimes([start], occupied).starts.length > 0);
  }
});
