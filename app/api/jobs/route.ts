import { runJobs } from "@/lib/server/jobs";
import { bearer, handle } from "@/lib/server/http";
import { equal } from "@/lib/server/security";
import { required } from "@/lib/server/config";
import { BookingError } from "@/lib/booking-policy";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return handle(async () => { if (!equal(bearer(request), required("CRON_SECRET"))) throw new BookingError("Unauthorized.", 401); return runJobs(3); });
}
