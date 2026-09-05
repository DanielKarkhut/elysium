export const ROOMS = [
  { id: "control", name: "Control room", hourlyRate: 50 },
  { id: "studio", name: "Full studio", hourlyRate: 100 },
] as const;

export type RoomId = (typeof ROOMS)[number]["id"];
export type Customer = { room: RoomId | ""; artist: string; email: string; phone: string };
export type TimeRange = { id: string; start: number; end: number };
export type Booking = { customer: Customer; date: Date; start: number; end: number };

// Minutes after midnight; values above 1440 belong to the following day.
const MOCK_AVAILABILITY: TimeRange[] = [
  { id: "day", start: 600, end: 900 },
  { id: "evening", start: 1050, end: 1200 },
  { id: "night", start: 1260, end: 1560 },
];
export const MINIMUM_MINUTES = 60;
export const TIME_INCREMENT = 30;
export const MOCK_FEE_RATE = 0.0692;

export function getAvailability(date: Date): TimeRange[] {
  // Sundays are closed. All other dates use the reference's three windows.
  return date.getDay() === 0 ? [] : MOCK_AVAILABILITY;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDate(date: Date) {
  const day = date.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return `${date.toLocaleString("en-US", { month: "long" })} ${day}${suffix}`;
}

export function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function timeOptions(start: number, end: number) {
  return Array.from({ length: Math.max(0, Math.floor((end - start) / TIME_INCREMENT) + 1) }, (_, i) => start + i * TIME_INCREMENT);
}

export function isValidTimeRange(range: TimeRange, start: number | null, end: number | null) {
  return start !== null && end !== null && start >= range.start && end <= range.end && end - start >= MINIMUM_MINUTES && start % TIME_INCREMENT === 0 && end % TIME_INCREMENT === 0;
}

export function getPricing(booking: Booking) {
  const room = ROOMS.find((item) => item.id === booking.customer.room) ?? ROOMS[0];
  const hours = (booking.end - booking.start) / 60;
  const subtotal = Math.round(hours * room.hourlyRate * 100);
  const fees = Math.round(subtotal * MOCK_FEE_RATE);
  const total = subtotal + fees;
  const deposit = Math.round(total / 2);
  return { room, hours, subtotal, fees, total, deposit, balance: total - deposit };
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
