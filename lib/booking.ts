export const ROOMS = [
  { id: "control", name: "Control room", hourlyRate: 50 },
  { id: "studio", name: "Full studio", hourlyRate: 100 },
] as const;
export function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
export function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
