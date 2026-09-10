import { dateKey, getAvailability, isValidTimeRange, MINIMUM_MINUTES, ROOMS, startOfDay, TIME_INCREMENT, type Customer } from "./booking.ts";

export const BOOKING_SESSION_KEY = "elysium:booking-session:v1";
export const BOOKING_SESSION_TTL = 20 * 60 * 1000;
// Bump when the displayed booking terms change.
export const BOOKING_TERMS_VERSION = "1";
export type CustomerErrors = Partial<Record<keyof Customer, string>>;
export type BookingDraft = {
  step: number;
  customer: Customer;
  date: string | null;
  calendarMonth: string;
  rangeId: string | null;
  start: number | null;
  end: number | null;
  acceptance: { version: string; details: string } | null;
  dialog: "info" | "terms" | null;
  reference: string;
  validationAttempted: boolean;
};

export function emptyBookingDraft(now = new Date()): BookingDraft {
  return { step: 0, customer: { room: "", artist: "", email: "", phone: "" }, date: null,
    calendarMonth: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), rangeId: null,
    start: null, end: null, acceptance: null, dialog: null, reference: "", validationAttempted: false };
}

export function customerErrors(customer: Customer): CustomerErrors {
  const errors: CustomerErrors = {};
  if (!ROOMS.some((room) => room.id === customer.room)) errors.room = "Choose a room to continue.";
  if (!customer.artist.trim()) errors.artist = "Enter your artist name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())) errors.email = "Enter a valid email address.";
  const digits = customer.phone.replace(/\D/g, "").length;
  if (!/^[+()\d\s.-]+$/.test(customer.phone.trim()) || digits < 7 || digits > 15) errors.phone = "Enter a valid phone number.";
  return errors;
}

export function parseBookingDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return dateKey(date) === value ? date : null;
}

export function bookingDetails(draft: BookingDraft): string {
  const { customer, date, rangeId, start, end } = draft;
  return JSON.stringify([customer.room, customer.artist, customer.email, customer.phone, date, rangeId, start, end]);
}

export function hasAcceptedTerms(draft: BookingDraft): boolean {
  return draft.acceptance?.version === BOOKING_TERMS_VERSION && draft.acceptance.details === bookingDetails(draft);
}

export function updateBookingDraft(draft: BookingDraft, patch: Partial<BookingDraft>): BookingDraft {
  const next = { ...draft, ...patch };
  if (!hasAcceptedTerms(next)) next.acceptance = null;
  if (bookingDetails(draft) !== bookingDetails(next)) next.reference = "";
  if (next.step === 6 && !next.acceptance) next.step = 5;
  return next;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function serializeBookingDraft(draft: BookingDraft, expiresAt: number): string {
  // Consent belongs only to the current page; never write it to browser storage.
  return JSON.stringify({ version: 1, expiresAt, draft: { ...draft, acceptance: undefined } });
}

// Storage is untrusted. Preserve partial input, but never restore an unreachable screen.
export function restoreBookingDraft(raw: string | null, now = Date.now()): { draft: BookingDraft; expiresAt: number } | null {
  if (!raw) return null;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.version !== 1 || typeof saved.expiresAt !== "number" ||
      !Number.isFinite(saved.expiresAt) || saved.expiresAt <= now || saved.expiresAt > now + BOOKING_SESSION_TTL || !record(saved.draft)) return null;
    const value = saved.draft;
    if (!record(value.customer)) return null;
    const savedCustomer = value.customer;
    const draft = emptyBookingDraft(new Date(now));
    const fields = { artist: 80, email: 254, phone: 30 } as const;
    for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
      if (typeof value.customer[field] !== "string" || value.customer[field].length > fields[field]) return null;
      draft.customer[field] = value.customer[field];
    }
    draft.customer.room = ROOMS.find((room) => room.id === savedCustomer.room)?.id ?? "";
    draft.step = typeof value.step === "number" && Number.isInteger(value.step) && value.step >= 0 && value.step <= 7 ? value.step : 0;
    draft.validationAttempted = value.validationAttempted === true;
    draft.dialog = value.dialog === "info" || value.dialog === "terms" ? value.dialog : null;
    draft.reference = typeof value.reference === "string" && /^ELY-[A-F0-9]{8}$/.test(value.reference) ? value.reference : "";
    const today = startOfDay(new Date(now));
    const latestMonth = new Date(today.getFullYear() + 1, today.getMonth(), 1);
    const lastDay = new Date(latestMonth.getFullYear(), latestMonth.getMonth() + 1, 0);
    const date = parseBookingDate(value.date);
    // Completed demo receipts may still be viewed after midnight.
    const completed = draft.step === 7 && !!draft.reference;
    if (date && (completed || (date >= today && date <= lastDay))) draft.date = dateKey(date);
    const month = parseBookingDate(value.calendarMonth);
    if (month && month.getDate() === 1 && month >= new Date(today.getFullYear(), today.getMonth(), 1) && month <= latestMonth) draft.calendarMonth = dateKey(month);
    const range = draft.date && date ? getAvailability(date).find((item) => item.id === value.rangeId) : null;
    draft.rangeId = range?.id ?? null;
    if (range && typeof value.start === "number" && Number.isInteger(value.start) && value.start % TIME_INCREMENT === 0 && value.start >= range.start && value.start <= range.end - MINIMUM_MINUTES) draft.start = value.start;
    if (range && typeof value.end === "number" && isValidTimeRange(range, draft.start, value.end)) draft.end = value.end;
    // Ignore consent saved by older versions too: every reload requires acceptance again.
    if (draft.step >= 2 && Object.keys(customerErrors(draft.customer)).length) {
      draft.step = 1;
      draft.validationAttempted = true;
    }
    if (draft.step >= 3 && !draft.date) draft.step = 2;
    if (draft.step >= 4 && !range) draft.step = 3;
    if (draft.step >= 5 && (!range || !isValidTimeRange(range, draft.start, draft.end))) draft.step = 4;
    if (draft.step === 7 && !draft.reference) draft.step = 6;
    if (draft.step === 6 && !hasAcceptedTerms(draft)) draft.step = 5;
    if (draft.step !== 7) draft.reference = "";
    if (draft.dialog === "terms" && draft.step < 5) draft.dialog = null;
    return { draft, expiresAt: saved.expiresAt };
  } catch {
    return null;
  }
}
