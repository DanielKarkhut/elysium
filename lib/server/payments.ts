import "server-only";
import Stripe from "stripe";
import { BookingError } from "../booking-policy.ts";
import { baseUrl, required } from "./config.ts";
import { authorize, dto, load, save, sweep } from "./bookings.ts";
import { transaction } from "./db.ts";

export function stripeClient() {
  const key = required("STRIPE_SECRET_KEY");
  const test = process.env.BOOKING_MODE === "test";
  if (!key.startsWith(test ? "sk_test_" : "sk_live_")) {
    throw new BookingError("Stripe and booking payment modes do not match. Please contact the studio.", 503);
  }
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 1 });
}

export function assertPaymentsConfigured() {
  stripeClient();
  required("STRIPE_WEBHOOK_SECRET");
  const test = process.env.BOOKING_MODE === "test";
  if (!required("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY").startsWith(test ? "pk_test_" : "pk_live_")) {
    throw new BookingError("Stripe and booking payment modes do not match. Please contact the studio.", 503);
  }
  if (!test && !baseUrl().startsWith("https://")) throw new BookingError("Secure checkout is not configured.", 503);
}

// A single intent per reservation, including retries after network/DB failures.
export async function prepareDeposit(credential: string, now = Date.now()) {
  assertPaymentsConfigured();
  await sweep(now);
  return transaction(async c => {
    const b = await authorize(c, credential, "guest", now);
    if (b.testMode !== (process.env.BOOKING_MODE === "test")) throw new BookingError("This booking belongs to a different payment mode.", 409);
    if (b.depositPaid >= b.depositDue) return { token: credential, clientSecret: null, status: "succeeded" as const };
    if (b.status !== "pending" || b.approvalBy <= now) throw new BookingError("This checkout has expired or closed. Please start a new booking.", 409);
    if (b.depositPaid > 0) throw new BookingError("Contact the studio to finish paying this existing deposit.", 409);
    const stripe = stripeClient();
    const intent = b.stripePaymentIntentId
      ? await stripe.paymentIntents.retrieve(b.stripePaymentIntentId)
      : await stripe.paymentIntents.create({
        amount: b.depositDue, currency: "usd", payment_method_types: ["card", "cashapp"],
        receipt_email: b.customer.email,
        description: `Elysium ${b.reference} — studio deposit`,
        metadata: { bookingId: b.id, purpose: "booking_deposit" },
      }, { idempotencyKey: `booking-deposit:${b.id}` });
    if (!b.stripePaymentIntentId) {
      b.stripePaymentIntentId = intent.id;
      await c.query("UPDATE bookings SET data = $2 WHERE id = $1", [b.id, JSON.stringify(b)]);
    }
    if (intent.status === "canceled") throw new BookingError("This payment was cancelled. Contact the studio or start a new booking.", 409);
    return { token: credential, clientSecret: intent.client_secret, status: intent.status };
  });
}

// Called only with a signature-verified webhook or an intent retrieved by our server.
export async function recordStripeDeposit(intent: Stripe.PaymentIntent, now = Date.now()) {
  if (intent.status !== "succeeded" || intent.metadata.purpose !== "booking_deposit") return;
  await sweep(now);
  return transaction(async c => {
    const b = await load(c, intent.metadata.bookingId);
    if (b.stripePaymentIntentId !== intent.id || intent.currency !== "usd" ||
        intent.amount !== b.depositDue || intent.amount_received !== b.depositDue || intent.livemode === b.testMode) {
      throw new BookingError("Stripe payment does not match this booking.", 409);
    }
    if (b.depositPaid === b.depositDue) return dto(b, now);
    if (b.depositPaid !== 0) throw new BookingError("This deposit needs reconciliation.", 409);
    b.depositPaid = intent.amount_received;
    // A delayed payment must never restore released occupancy or lose its refund.
    if (b.status === "cancelled") b.cancellationRefundable = true;
    await save(c, b, `Stripe deposit received: ${intent.id}.${b.status === "pending" ? " Awaiting studio approval." : " Booking is closed; review the refund owed."}`, "stripe");
    return dto(b, now);
  });
}

// Recover even when the browser returns before the webhook or closes mid-payment.
export async function syncDeposit(credential: string, now = Date.now()) {
  const b = await transaction(c => authorize(c, credential, "guest", now));
  if (!b.stripePaymentIntentId || b.depositPaid >= b.depositDue) return;
  const intent = await stripeClient().paymentIntents.retrieve(b.stripePaymentIntentId);
  await recordStripeDeposit(intent, now);
}
