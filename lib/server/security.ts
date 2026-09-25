import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { secret } from "./config.ts";
import { BookingError } from "../booking-policy.ts";
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function token(id: string, nonce: string, role: "guest" | "staff") {
  return `${id}.${createHmac("sha256", secret()).update(`${role}:${id}:${nonce}`).digest("base64url")}`;
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function tokenId(value: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/.test(value)) throw new BookingError("This private link is invalid or has expired.", 401);
  return value.split(".")[0];
}
export function rateKey(value: string) { return createHmac("sha256", secret()).update(value).digest("hex"); }
