import { recordStripeDeposit, stripeClient } from "@/lib/server/payments";
import { required } from "@/lib/server/config";
import { handle, json } from "@/lib/server/http";
import type Stripe from "stripe";
import { BookingError } from "@/lib/booking-policy";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing Stripe signature." }, 400);
  // Stripe requires the original, unparsed body for signature verification.
  const payload = await request.text();
  return handle(async () => {
    const stripe = stripeClient(), secret = required("STRIPE_WEBHOOK_SECRET");
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(payload, signature, secret); }
    catch { throw new BookingError("Invalid Stripe signature.", 400); }
    if (event.type === "payment_intent.succeeded") await recordStripeDeposit(event.data.object);
    return { received: true };
  });
}
