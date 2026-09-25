import { createBooking } from "@/lib/server/bookings";
import { body, handle } from "@/lib/server/http";
import { assertPaymentsConfigured, prepareDeposit } from "@/lib/server/payments";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request);
    assertPaymentsConfigured();
    const result = await createBooking(input);
    return { ...result, ...await prepareDeposit(result.token) };
  });
}
