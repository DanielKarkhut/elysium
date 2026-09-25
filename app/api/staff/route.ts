import { staffMutation, readBooking } from "@/lib/server/bookings";
import { bearer, body, handle } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { return handle(() => readBooking(bearer(request), "staff")); }
export async function POST(request: Request) { return handle(async () => staffMutation(bearer(request), await body(request))); }
