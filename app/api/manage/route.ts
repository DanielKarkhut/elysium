import { guestMutation, readBooking } from "@/lib/server/bookings";
import { bearer, body, handle } from "@/lib/server/http";
import { syncDeposit } from "@/lib/server/payments";
export const runtime = "nodejs";
export async function GET(request: Request) { return handle(async () => {
  const credential = bearer(request);
  await syncDeposit(credential);
  return readBooking(credential, "guest");
}); }
export async function POST(request: Request) { return handle(async () => guestMutation(bearer(request), await body(request))); }
