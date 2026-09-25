import "server-only";
import { ZodError } from "zod";
import { BookingError } from "../booking-policy.ts";
import { baseUrl } from "./config.ts";
export function bearer(request: Request) { return request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""; }
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export async function body(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== baseUrl()) throw new BookingError("Request origin is not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new BookingError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new BookingError("Request body is missing.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new BookingError("Request is too large.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new BookingError("Invalid JSON."); }
}
export async function handle(fn: () => Promise<unknown>) {
  try { return json(await fn()); }
  catch (error) {
    if (error instanceof BookingError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) return json({ error: "Check the required fields, dates, and booking terms." }, 400);
    if (typeof error === "object" && error && "code" in error && error.code === "23P01") return json({ error: "That time was just reserved. Choose another time." }, 409);
    console.error("Booking operation failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "Booking service is temporarily unavailable. Please try again or contact the studio." }, 503);
  }
}
