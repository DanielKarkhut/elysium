"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ROOMS, dateKey, money } from "@/lib/booking";
import { cutoff, displayTime, MAXIMUM_SESSION_HOURS, TERMS_VERSION, type Price, type Slot } from "@/lib/booking-policy";
import { BookingInput } from "./BookingInput";
import { BookingLayout } from "./BookingLayout";
import { BookingCalendar } from "./BookingCalendar";
import { Logo } from "./Logo";
import { PrimaryButton } from "./PrimaryButton";
import { BookingDialog } from "./BookingDialog";
import { useBookingSession } from "./useBookingSession";
import { api } from "./TimeFields";
import { TimeSelection, UsageGuidance } from "./TimeSelection";
import { BookingSummary } from "./BookingSummary";
import { DepositPayment, type DepositCheckout } from "./DepositPayment";

type Quote = Price & { pricingReady: boolean; testMode: boolean };
export function BookingFlow() {
  const router = useRouter();
  const { snapshot, update, reset } = useBookingSession();
  const restored = useRef(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedSlot, setQuotedSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dialog, setDialog] = useState<"info" | "terms" | null>(null);
  const [recoverEmail, setRecoverEmail] = useState(""), [recovery, setRecovery] = useState("");
  useEffect(() => { if (snapshot?.draft.step === 0) { setQuote(null); setQuotedSlot(null); } }, [snapshot?.draft.step]);
  useEffect(() => {
    if (!snapshot || restored.current) return;
    restored.current = true;
    if (snapshot.draft.checkoutToken) {
      const token = snapshot.draft.checkoutToken;
      reset(); router.replace(`/manage#${token}`);
    }
  }, [snapshot, reset, router]);
  if (!snapshot) return <p role="status" className="p-8 text-center">Restoring your booking…</p>;
  const { draft, notice, storageUnavailable } = snapshot;
  const { customer, step } = draft;
  const selected = new Date(`${draft.date}T12:00:00`);
  const change = (field: keyof typeof customer, value: string) => update({ customer: { ...customer, [field]: value } });
  async function review(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!draft.start || !customer.room) throw new Error("Choose a room and start time.");
      const duration = Number(draft.duration);
      if (!Number.isFinite(duration) || duration < 2 || duration > MAXIMUM_SESSION_HOURS || duration * 2 % 1) throw new Error("Choose 2–23 hours in 30-minute increments.");
      const slot: Slot = { start: draft.start, end: new Date(Date.parse(draft.start) + duration * 3600000).toISOString(), room: customer.room };
      setQuote(await api("/api/quote", slot)); setQuotedSlot(slot); update({ step: 4, accepted: false });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function preparePayment(): Promise<DepositCheckout> {
    if (!quotedSlot || !quote || !draft.accepted) throw new Error("Accept the terms before paying.");
    const requestKey = draft.requestKey || crypto.randomUUID(); update({ requestKey });
    const { room: _room, ...contact } = customer; void _room;
    const result: DepositCheckout = await api("/api/bookings", { customer: contact, slot: quotedSlot, termsVersion: TERMS_VERSION, requestKey, quotedTotal: quote.total });
    update({ checkoutToken: result.token });
    return result;
  }
  async function recover(event: FormEvent) {
    event.preventDefault(); setBusy(true); setRecovery(""); setError("");
    try { setRecovery((await api("/api/recover", { email: recoverEmail })).message); }
    catch (e) { setRecovery((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    {(notice || storageUnavailable) && <p role="status" className="mx-auto max-w-md px-6 pt-4 text-center text-xs">{notice} {storageUnavailable && "Draft recovery is unavailable in this browser."}</p>}
    <BookingLayout step={step} onBack={() => {
      if (busy) return;
      if (draft.checkoutToken) { reset(); router.push(`/manage#${draft.checkoutToken}`); return; }
      setError(""); update({ step: Math.max(0, step - 1), accepted: false });
    }}>
      {error && <p role="alert" className="booking-notice">{error}</p>}
      {step === 0 && <div className="landing-content flex flex-1 flex-col items-center">
        <h1 className="sr-only">Elysium studio booking</h1><Logo landing />
        <nav className="landing-nav flex items-center justify-center" aria-label="Get started"><button onClick={() => setDialog("info")}>Info</button><span>|</span><button onClick={() => update({ step: 1 })}>Booking</button></nav>

      </div>}
      {step === 1 && <form className="customer-form flex flex-1 flex-col" onSubmit={e => { e.preventDefault(); setError(""); update({ step: 2 }); }}>
        <h1 className="sr-only">Customer information</h1><div className="customer-fields flex flex-col">
          <BookingInput id="room" label="Room to book"><select id="room" className="booking-input" value={customer.room} required onChange={e => change("room", e.target.value)}><option value="" disabled>Choose a room</option>{ROOMS.map(r => <option key={r.id} value={r.id}>{r.name} · ${r.hourlyRate}/hour</option>)}</select></BookingInput>
          <BookingInput id="artist" label="Artist name" value={customer.artist} required maxLength={80} onChange={e => change("artist", e.target.value)} />
          <BookingInput id="email" label="Email address" type="email" value={customer.email} required maxLength={254} onChange={e => change("email", e.target.value)} />
          <BookingInput id="phone" label="Phone number" type="tel" value={customer.phone} required minLength={7} maxLength={30} onChange={e => change("phone", e.target.value)} />
        </div><PrimaryButton type="submit" className="customer-next">Time selection</PrimaryButton>
      </form>}
      {step === 2 && <section className="calendar-step">
        <h1 className="sr-only">Select a booking date</h1>
        <BookingCalendar key={draft.calendarMonth} selected={selected} month={new Date(`${draft.calendarMonth}T12:00:00`)} onMonthChange={d => update({ calendarMonth: dateKey(d) })} onSelect={d => update({ date: dateKey(d), calendarMonth: dateKey(new Date(d.getFullYear(), d.getMonth(), 1)), ...(dateKey(d) !== draft.date ? { start: "", duration: "" } : {}), step: 3 })} />
        <UsageGuidance />
      </section>}
      {step === 3 && <TimeSelection draft={draft} update={update} busy={busy} onReview={review} />}
      {step === 4 && quote && quotedSlot && <section className="review-step flex flex-1 flex-col">
        <h1 className="screen-title text-center">Review</h1>
        <BookingSummary slot={quotedSlot} pricing={quote} />
        <p className="deposit-note text-center">50% deposit · {money(quote.deposit)}<br />Studio approval required</p>
        <div className="terms-row flex items-center justify-center gap-2">
          <input id="terms" type="checkbox" aria-label="I accept the terms and conditions" checked={draft.accepted} disabled={busy} className="size-4 shrink-0 accent-primary" onChange={e => update({ accepted: e.target.checked })} />
          <span className="terms-copy"><label htmlFor="terms">I accept the </label><button className="underline underline-offset-4" onClick={() => setDialog("terms")}>terms and conditions</button></span>
        </div>
        {draft.accepted && (quote.pricingReady || quote.testMode) && <div className="payment-action"><DepositPayment amount={quote.deposit} testMode={quote.testMode} prepare={preparePayment} onBusy={setBusy} onComplete={token => { reset(); router.push(`/manage#${token}`); }} /></div>}
        {(!quote.pricingReady || quote.testMode) && <p className="booking-notice mt-5">{quote.testMode ? "Test checkout — no real money is charged." : "Online booking is not open yet. Final tax settings are awaiting confirmation."}</p>}
        <div className="usage-guidance space-y-3 text-secondary">
          <p>Pay your deposit with Apple Pay or Cash App Pay. Your payment is recorded automatically, and the studio will review your request.</p>
          <p>The deposit is nonrefundable from {displayTime(new Date(cutoff(quotedSlot)).toISOString())}. For bookings less than 24 hours away, it is immediately nonrefundable.</p>
        </div>
      </section>}
    </BookingLayout>
    {dialog && <BookingDialog title={dialog === "info" ? "Space to create." : "Booking terms"} onClose={() => setDialog(null)}>
      <p>Open 24/7 in New York. Control room $50/hour; full studio $100/hour. Both share one schedule, with 15 minutes between sessions. Sessions last 2–23 hours, in 30-minute increments.</p>
      <p>Pay the 50% deposit securely through Stripe using Apple Pay or Cash App Pay. Once checkout starts, your time is held for 15 minutes to complete payment. The studio must approve your paid request within 48 hours of the request, or before its start if sooner.</p>
      <p>For artist cancellations, deposits are refundable only more than 24 hours before the session starts. At or after that cutoff they are nonrefundable, including same-day bookings. A nonrefundable deposit stays nonrefundable after rescheduling.</p>
      <p>Changes and extensions require approval and availability. Original hourly rates and deposit stay fixed; the remaining balance is collected manually. If the completed session costs less than your deposit, the studio refunds the excess manually.</p>
      <p>Declined or expired requests do not become confirmed bookings; any payment received for them must be returned by the studio. Keep your email management link private. It works until your approved session ends.</p>
      {dialog === "info" && <details className="mt-8 w-full text-sm"><summary className="text-center">Manage an existing booking</summary><form onSubmit={recover} className="mt-5 space-y-4"><BookingInput id="recover-email" label="Booking email" type="email" required value={recoverEmail} onChange={e => setRecoverEmail(e.target.value)} /><PrimaryButton type="submit" disabled={busy}>Email my link</PrimaryButton><p role="status" className="text-xs leading-relaxed">{recovery}</p></form></details>}
    </BookingDialog>}
  </>;
}
