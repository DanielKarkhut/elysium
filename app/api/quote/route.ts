import { quote } from "@/lib/server/bookings";
import { bearer, body, handle } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return handle(async () => quote(await body(request), bearer(request) || undefined)); }
