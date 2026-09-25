import { availability, calendarAvailability } from "@/lib/server/bookings";
import { bearer, handle } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return handle(() => params.has("month")
    ? calendarAvailability(params.get("month") ?? "")
    : availability(params.get("day") ?? "", bearer(request) || undefined));
}
