import "server-only";
import { BookingError } from "../booking-policy.ts";

export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new BookingError("Booking service is not configured yet. Please contact the studio.", 503);
  return value;
}
export function secret() {
  const value = required("BOOKING_SECRET");
  if (value.length < 32) throw new BookingError("Booking service configuration is incomplete.", 503);
  return value;
}
export function baseUrl() { return new URL(required("APP_URL")).origin; }
export function pricingConfig() {
  const taxBps = Number(process.env.BOOKING_TAX_BPS ?? "0");
  // Tenth-basis-point precision represents rates such as 8.875% exactly.
  if (!Number.isFinite(taxBps) || !Number.isInteger(taxBps * 10) || taxBps < 0 || taxBps > 10000) throw new BookingError("Pricing is not configured.", 503);
  return { taxBps, ready: process.env.PRICING_CONFIRMED === "true" };
}
export function assertBookingEnabled() {
  if (process.env.BOOKING_MODE !== "test" && !pricingConfig().ready)
    throw new BookingError("Online booking will open once the studio confirms pricing. Please contact the studio.", 503);
  baseUrl(); secret();
}
