"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, ExpressCheckoutElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { money } from "@/lib/booking";

export type DepositCheckout = { token: string; clientSecret: string | null; status: string };
type Props = {
  amount: number;
  testMode: boolean;
  prepare: () => Promise<DepositCheckout>;
  onComplete: (token: string) => void;
  onBusy?: (busy: boolean) => void;
};
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: ReturnType<typeof loadStripe> | undefined;
function getStripe() {
  return stripePromise ??= loadStripe(publishableKey!);
}

export function DepositPayment(props: Props) {
  if (!publishableKey || !publishableKey.startsWith(props.testMode ? "pk_test_" : "pk_live_")) {
    return <p role="status" className="booking-notice">Online payments are not configured yet. Please contact the studio.</p>;
  }
  return <PaymentProvider {...props} />;
}

function PaymentProvider(props: Props) {
  const [stripe] = useState(() => getStripe().catch(() => null));
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void stripe.then(value => { if (active && !value) setLoadFailed(true); });
    return () => { active = false; };
  }, [stripe]);
  if (loadFailed) return <p role="alert" className="booking-notice">Secure payments could not load. Check your connection and refresh to try again.</p>;
  return <Elements stripe={stripe} options={{ mode: "payment", currency: "usd", amount: props.amount,
    paymentMethodTypes: ["card", "cashapp"], appearance: { variables: { borderRadius: "28px" } } }}>
    <PaymentButtons {...props} />
  </Elements>;
}

function PaymentButtons({ amount, prepare, onComplete, onBusy }: Props) {
  const stripe = useStripe(), elements = useElements();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [applePay, setApplePay] = useState<boolean | null>(null);
  const [credential, setCredential] = useState("");

  async function pay(method: "apple" | "cashapp", event?: StripeExpressCheckoutElementConfirmEvent) {
    if (!stripe || !elements || inFlight.current) { event?.paymentFailed({ reason: "fail" }); return; }
    inFlight.current = true; setBusy(true); onBusy?.(true); setError("");
    try {
      if (method === "apple") {
        const submitted = await elements.submit();
        if (submitted.error) throw new Error(submitted.error.message ?? "Please try Apple Pay again.");
      }
      const checkout = await prepare();
      setCredential(checkout.token);
      if (checkout.status === "succeeded" || checkout.status === "processing") { onComplete(checkout.token); return; }
      if (!checkout.clientSecret) throw new Error("Unable to start payment. Please try again.");
      const returnUrl = `${window.location.origin}/manage#${checkout.token}`;
      const result = method === "apple"
        ? await stripe.confirmPayment({ elements, clientSecret: checkout.clientSecret, confirmParams: { return_url: returnUrl }, redirect: "if_required" })
        : await stripe.confirmCashappPayment(checkout.clientSecret, { payment_method: {}, return_url: returnUrl });
      if (result.error) throw new Error(result.error.message ?? "Payment was not completed. Please try again.");
      if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") onComplete(checkout.token);
      else throw new Error("Payment was not completed. You can try again.");
    } catch (e) {
      event?.paymentFailed({ reason: "fail" });
      setError(e instanceof Error ? e.message : "Payment is unavailable. Please try again.");
    } finally { inFlight.current = false; setBusy(false); onBusy?.(false); }
  }

  return <div className="deposit-payment space-y-3" aria-busy={busy}>
    <p className="text-center text-xs">Pay {money(amount)} deposit</p>
    <div className={busy ? "pointer-events-none opacity-60" : ""}>
      <ExpressCheckoutElement options={{ buttonHeight: 56, buttonType: { applePay: "book" }, buttonTheme: { applePay: "black" },
        paymentMethods: { applePay: "always", googlePay: "never", link: "never", paypal: "never", amazonPay: "never", klarna: "never" },
        layout: { maxColumns: 1, maxRows: 1 } }}
        onReady={e => setApplePay(Boolean(e.availablePaymentMethods?.applePay))}
        onLoadError={() => { setApplePay(false); setError("Apple Pay could not load. You can still try Cash App Pay."); }}
        onConfirm={event => { void pay("apple", event); }} />
    </div>
    <button type="button" className="cash-app-button disabled:opacity-50" disabled={!stripe || busy} onClick={() => { void pay("cashapp"); }}>Pay with Cash App</button>
    {applePay === false && <p className="text-center text-xs text-secondary">Apple Pay is available on supported devices and browsers.</p>}
    <p role="status" className="text-center text-xs text-secondary">{busy ? "Completing your payment…" : !stripe ? "Loading secure payments…" : "Secure payment by Stripe"}</p>
    {error && <p role="alert" className="booking-notice">{error}</p>}
    {credential && error && <a href={`/manage#${credential}`} className="block text-center text-xs underline">View or resume this booking</a>}
  </div>;
}
