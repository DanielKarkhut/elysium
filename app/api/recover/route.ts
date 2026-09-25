import { recover } from "@/lib/server/bookings";
import { body, handle } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => { const data = await body(request); await recover(data.email); return { message: "If this email has an accessible booking, its private link will be emailed to you." }; });
}
