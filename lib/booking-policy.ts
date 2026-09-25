import { Temporal } from "@js-temporal/polyfill";

export const STUDIO_TIME_ZONE = "America/New_York";
export const MAXIMUM_SESSION_HOURS = 23;
export const TERMS_VERSION = "2026-09-stripe-v1";
export const RATES = { control: 5000, studio: 10000 } as const;
export type Room = keyof typeof RATES;
export type Slot = { start: string; end: string; room: Room };
export type Price = { subtotal: number; tax: number; total: number; deposit: number };
export class BookingError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function instant(value: string) {
  try { return Temporal.Instant.from(value); }
  catch { throw new BookingError("Choose a valid date and time."); }
}
export function studioNow(now = Date.now()) {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(STUDIO_TIME_ZONE);
}
export function studioDate(now = Date.now()) { return studioNow(now).toPlainDate().toString(); }
export function horizon(now = Date.now()) { return studioNow(now).add({ months: 3 }).epochMilliseconds; }
export function validateSlot(slot: Slot, now: number, original?: Slot) {
  const start = instant(slot.start), end = instant(slot.end);
  for (const time of [start, end]) {
    const local = time.toZonedDateTimeISO(STUDIO_TIME_ZONE);
    if (local.minute % 30 || local.second || local.millisecond || local.microsecond || local.nanosecond)
      throw new BookingError("Sessions use 30-minute increments.");
  }
  const minutes = (end.epochMilliseconds - start.epochMilliseconds) / 60000;
  if (minutes < 120 || minutes % 30) throw new BookingError("Sessions must last at least 2 hours, in 30-minute increments.");
  if (minutes > MAXIMUM_SESSION_HOURS * 60) throw new BookingError(`Sessions cannot exceed ${MAXIMUM_SESSION_HOURS} hours from the start time.`);
  if (!(slot.room in RATES)) throw new BookingError("Choose a room.");
  if (original && instant(original.start).epochMilliseconds <= now) {
    if (now >= instant(original.end).epochMilliseconds) throw new BookingError("This session has ended.");
    if (slot.start !== original.start || slot.room !== original.room || end.epochMilliseconds <= instant(original.end).epochMilliseconds)
      throw new BookingError("During a session you can only extend its end time.");
  } else if (start.epochMilliseconds <= now || start.epochMilliseconds > horizon(now)) {
    throw new BookingError("Choose a future start time within the next 3 calendar months.");
  }
  return minutes;
}
export function price(slot: Slot, rates: Record<Room, number>, taxBps: number): Price {
  const hours = (instant(slot.end).epochMilliseconds - instant(slot.start).epochMilliseconds) / 3600000;
  const subtotal = Math.round(hours * rates[slot.room]);
  const tax = Math.round(subtotal * Math.round(taxBps * 10) / 100000);
  const total = subtotal + tax;
  if (!Number.isSafeInteger(total) || total < 0) throw new BookingError("The requested duration is too large.");
  return { subtotal, tax, total, deposit: Math.round(total / 2) };
}
export function cutoff(slot: Slot) { return instant(slot.start).epochMilliseconds - 24 * 3600000; }
export function approvalDeadline(slot: Slot, now: number) { return Math.min(now + 48 * 3600000, instant(slot.start).epochMilliseconds); }
export function refundable(slot: Slot, now: number, locked: boolean) { return !locked && now < cutoff(slot); }
export function daySlots(day: string, now: number) {
  let date: Temporal.PlainDate;
  try { date = Temporal.PlainDate.from(day); } catch { throw new BookingError("Choose a valid day."); }
  if (day !== date.toString() || day < studioDate(now) || day > studioNow(now).add({ months: 3 }).toPlainDate().toString())
    throw new BookingError("Choose a day within the next 3 months.");
  const begin = date.toZonedDateTime({ timeZone: STUDIO_TIME_ZONE, plainTime: "00:00" });
  const end = begin.add({ days: 1 });
  const latestStart = horizon(now);
  const result: string[] = [];
  for (let t = begin.epochMilliseconds; t < end.epochMilliseconds; t += 1800000)
    if (t > now && t <= latestStart) result.push(new Date(t).toISOString());
  return result;
}
export function monthDays(month: string, now: number) {
  let first: Temporal.PlainDate;
  try { first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 }); }
  catch { throw new BookingError("Choose a valid month."); }
  if (!/^\d{4}-\d{2}$/.test(month) || first.toString().slice(0, 7) !== month)
    throw new BookingError("Choose a valid month.");
  const today = studioDate(now), last = studioDate(horizon(now));
  return Array.from({ length: first.daysInMonth }, (_, i) => first.add({ days: i }).toString())
    .filter(day => day >= today && day <= last);
}
export function displayTime(value: string) {
  return new Date(value).toLocaleString("en-US", { timeZone: STUDIO_TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
