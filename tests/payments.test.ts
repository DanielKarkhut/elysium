import assert from "node:assert/strict";
import { test } from "node:test";
import Stripe from "stripe";
import { assertPaymentsConfigured } from "../lib/server/payments.ts";
import { POST } from "../app/api/stripe/webhook/route.ts";

test("Stripe configuration prevents mixing test bookings and real charges", () => {
  process.env.BOOKING_MODE = "test";
  process.env.APP_URL = "http://localhost:3000";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_example";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
  assert.doesNotThrow(assertPaymentsConfigured);
  process.env.STRIPE_SECRET_KEY = "sk_live_example";
  assert.throws(assertPaymentsConfigured, /modes do not match/);
  process.env.BOOKING_MODE = "live";
  assert.throws(assertPaymentsConfigured, /modes do not match/);
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_example";
  assert.throws(assertPaymentsConfigured, /Secure checkout/);
  process.env.APP_URL = "https://example.com";
  assert.doesNotThrow(assertPaymentsConfigured);
  process.env.BOOKING_MODE = "test";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
});

test("webhook verifies the raw body, rejects tampering and acknowledges unrelated events", async () => {
  const stripe = new Stripe("sk_test_example");
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
  const payload = JSON.stringify({ id: "evt_test", type: "payment_intent.payment_failed", data: { object: {} } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_example" });
  const request = (body: string, header?: string) => new Request("http://localhost/api/stripe/webhook", {
    method: "POST", headers: header ? { "stripe-signature": header } : {}, body,
  });
  assert.equal((await POST(request(payload))).status, 400);
  assert.equal((await POST(request(payload + " ", signature))).status, 400);
  const response = await POST(request(payload, signature));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
});
