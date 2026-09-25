import { prepareDeposit } from "@/lib/server/payments";
import { bearer, body, handle } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    await body(request);
    return prepareDeposit(bearer(request));
  });
}
