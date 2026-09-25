import { z } from "zod";
import { studioDate, TERMS_VERSION } from "./booking-policy.ts";

export const BOOKING_SESSION_KEY = "elysium:booking-session:v2";
export const BOOKING_SESSION_TTL = 20 * 60 * 1000;
export const BOOKING_TERMS_VERSION = TERMS_VERSION;
const draftSchema = z.object({
  step: z.number().int().min(0).max(6), customer: z.object({ room: z.enum(["", "control", "studio"]), artist: z.string().max(80), email: z.string().max(254), phone: z.string().max(30) }),
  date: z.string(), calendarMonth: z.string(), start: z.string(), duration: z.string().max(12),
  accepted: z.boolean(), requestKey: z.string().uuid().or(z.literal("")),
  checkoutToken: z.string().max(300).optional(),
});
export type BookingDraft = z.infer<typeof draftSchema>;
export function emptyBookingDraft(now = new Date()): BookingDraft {
  const date = studioDate(now.getTime());
  const customer: BookingDraft["customer"] = process.env.NODE_ENV === "development"
    ? { room: "control", artist: "Test Artist", email: "artist@example.com", phone: "2025550100" }
    : { room: "", artist: "", email: "", phone: "" };
  return { step: 0, customer, date, calendarMonth: `${date.slice(0, 7)}-01`, start: "", duration: "2", accepted: false, requestKey: "" };
}
export function updateBookingDraft(draft: BookingDraft, patch: Partial<BookingDraft>) {
  const next = { ...draft, ...patch };
  if (JSON.stringify([draft.customer, draft.start, draft.duration, draft.date]) !== JSON.stringify([next.customer, next.start, next.duration, next.date])) {
    next.accepted = false; next.requestKey = "";
  }
  return next;
}
export function serializeBookingDraft(draft: BookingDraft, expiresAt: number) {
  return JSON.stringify({ version: 2, expiresAt, draft: { ...draft, accepted: false } });
}
export function restoreBookingDraft(raw: string | null, now = Date.now()): { draft: BookingDraft; expiresAt: number } | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved.version !== 2 || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= now || saved.expiresAt > now + BOOKING_SESSION_TTL) return null;
    const result = draftSchema.safeParse(saved.draft);
    if (!result.success) return null;
    const draft = result.data;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^\d{4}-\d{2}-01$/.test(draft.calendarMonth)) return null;
    draft.accepted = false;
    // Prices and availability must be fetched again before any submission.
    if (draft.step > 2) draft.step = 2;
    if (draft.date < studioDate(now)) { draft.date = studioDate(now); draft.start = ""; }
    return { draft, expiresAt: saved.expiresAt };
  } catch { return null; }
}
