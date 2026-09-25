import { MAXIMUM_SESSION_HOURS, STUDIO_TIME_ZONE, studioDate } from "./booking-policy.ts";

export const HALF_HOUR = 1800000;
export const MINIMUM_SESSION = 4 * HALF_HOUR;
export type AvailableTimes = { starts: string[]; endsByStart: Record<string, string[]> };
type OccupiedTime = { start: string; end: string };
function freeSession(start: number, end: number, blocks: { start: number; end: number }[]) {
  return !blocks.some(b => start < b.end && end + 900000 > b.start);
}
export function hasAvailableStart(starts: string[], occupied: OccupiedTime[]) {
  const blocks = occupied.map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  return starts.some(start => freeSession(Date.parse(start), Date.parse(start) + MINIMUM_SESSION, blocks));
}

// Occupied intervals already include the previous session's cleanup buffer.
export function availableTimes(starts: string[], occupied: OccupiedTime[]): AvailableTimes {
  const blocks = occupied.map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  const result: AvailableTimes = { starts: [], endsByStart: {} };
  for (const start of starts) {
    const time = Date.parse(start);
    const ends: string[] = [];
    for (let end = time + MINIMUM_SESSION; end <= time + MAXIMUM_SESSION_HOURS * 3600000; end += HALF_HOUR) {
      // A longer session cannot jump across an occupied period. Include its cleanup.
      if (!freeSession(time, end, blocks)) break;
      ends.push(new Date(end).toISOString());
    }
    if (ends.length) {
      result.starts.push(start);
      result.endsByStart[start] = ends;
    }
  }
  return result;
}

export function clockTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}
export function timeOptionLabel(value: string, day: string) {
  const localDay = studioDate(Date.parse(value));
  const zone = new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_TIME_ZONE, timeZoneName: "short" }).split(" ").at(-1);
  return `${clockTime(value)} ${zone}${localDay !== day ? ` (${localDay})` : ""}`;
}
export function dateHeading(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const n = date.getUTCDate();
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${n}${suffix}`;
}
