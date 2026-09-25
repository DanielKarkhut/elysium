"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { BookingView } from "@/lib/server/bookings";
import { displayTime, STUDIO_TIME_ZONE, TERMS_VERSION, type Slot } from "@/lib/booking-policy";
import { money, ROOMS } from "@/lib/booking";
import { api, TimeFields } from "./TimeFields";
import { BookingInput } from "./BookingInput";
import { PrimaryButton } from "./PrimaryButton";
import { Logo } from "./Logo";
import { BookingLayout } from "./BookingLayout";
import { BookingSummary } from "./BookingSummary";
import { DepositPayment } from "./DepositPayment";
import { useBookingSession } from "./useBookingSession";

export function ManageBooking({ staff = false }: { staff?: boolean }) {
  const { snapshot, reset } = useBookingSession();
  const [credential, setCredential] = useState("");
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [cancelReview, setCancelReview] = useState(false);
  const [paymentAction, setPaymentAction] = useState("record_balance"), [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const path = staff ? "/api/staff" : "/api/manage";
  const awaitingDeposit = booking?.status === "pending" && booking.depositPaid < booking.pricing.deposit;
  const refresh = useCallback(async (value: string) => { setBooking(await api(path, undefined, value)); }, [path]);
  useEffect(() => {
    if (credential && snapshot?.draft.checkoutToken === credential) reset();
  }, [credential, snapshot, reset]);
  useEffect(() => {
    const value = window.location.hash.slice(1);
    if (!value) { setError("Open the private booking link in your email. If you lost it, request a new email from the home page."); return; }
    // Remove Stripe return parameters (including client secrets) from the address bar.
    window.history.replaceState(null, "", `${window.location.pathname}#${value}`);
    setCredential(value);
    refresh(value).catch(e => setError(e.message));
    const timer = setInterval(() => { refresh(value).catch(e => setError(e.message)); }, awaitingDeposit ? 5000 : 30000);
    return () => clearInterval(timer);
  }, [refresh, awaitingDeposit]);
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (!booking) return;
    setBusy(true); setError(""); setMessage("");
    try {
      setBooking(await api(path, { action, version: booking.version, ...extra }, credential));
      setCancelReview(false); setMessage("Booking updated.");
    } catch (e) {
      setError((e as Error).message);
      try { await refresh(credential); } catch { /* Keep the error that explains the failed action. */ }
    } finally { setBusy(false); }
  }
  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    await mutate(paymentAction, { amount: Math.round(Number(amount) * 100), note });
  }
  const depositRemaining = booking ? Math.max(0, booking.pricing.deposit - booking.depositPaid) : 0;
  const content = <>
    {staff && <Link href="/" aria-label="Elysium home" className="block w-fit mx-auto"><Logo /></Link>}
    <h1 className={staff ? "text-3xl" : "screen-title text-center"}>{staff ? "Review booking" : booking?.status === "confirmed" ? "Booked" : booking?.status === "pending" ? "Requested" : "Your booking"}</h1>
    {error && <p role="alert" className="booking-notice">{error} {credential && <button onClick={() => { setError(""); refresh(credential).catch(e => setError(e.message)); }} className="underline">Refresh</button>}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {!booking && !error && <p role="status">Loading booking…</p>}
    {booking && <>
      {!staff && <>
        <BookingSummary slot={booking.slot} pricing={booking.pricing} />
        <div className="confirmation-message text-center" role="status">
          <p className="text-[17px] leading-tight">{booking.status === "confirmed" ? <>Your studio session<br />is confirmed</> : booking.status === "pending" ? <>Your request is received<br />{depositRemaining > 0 ? "Awaiting deposit" : "Awaiting studio approval"}</> : `Booking ${booking.status}`}</p>
          <p className="mt-3 text-[10px]">{booking.reference}</p>
        </div>
      </>}
      {booking.testMode && <p className="booking-notice mt-5">Test checkout — no real money is charged.</p>}
      <details className="mt-6 rounded-2xl border border-border p-5 space-y-3" open={staff}>
        <summary className="text-sm">Booking and payment details</summary>
        <p className="text-xs">{booking.reference}</p><p className="text-xl capitalize">{booking.status === "pending" ? depositRemaining > 0 ? "Awaiting deposit" : "Awaiting approval" : booking.status}</p>
        <p>{booking.customer.artist} · {ROOMS.find(r => r.id === booking.slot.room)?.name}</p>
        <p className="text-sm leading-relaxed">{displayTime(booking.slot.start)}<br />to {displayTime(booking.slot.end)}</p>
        {staff && <p className="text-sm break-words">{booking.customer.email}<br />{booking.customer.phone}</p>}
        <dl className="booking-totals"><dt>Session total</dt><dd>{money(booking.pricing.total)}</dd><dt>Original deposit</dt><dd>{money(booking.pricing.deposit)}</dd><dt>Deposit paid</dt><dd>{money(booking.depositPaid)}</dd><dt>Other payment received</dt><dd>{money(booking.balancePaid)}</dd><dt>Remaining balance</dt><dd>{money(booking.balanceOwed)}</dd><dt>Refund still owed</dt><dd>{money(booking.refundOwed)}</dd><dt>Refund recorded</dt><dd>{money(booking.refunded)}</dd></dl>
      </details>
      {booking.status === "pending" && <section className="space-y-4 rounded-2xl border border-border p-5">
        <h2 className="text-xl">{depositRemaining > 0 ? "Pay your deposit" : "Deposit paid"}</h2>
        {depositRemaining > 0 ? <>
          {staff ? <p className="text-sm">The deposit has not been received. Stripe records successful payments automatically.</p> : <DepositPayment amount={depositRemaining} testMode={booking.testMode} prepare={() => api("/api/payments", {}, credential)} onBusy={setBusy} onComplete={() => { void refresh(credential).catch(e => setError(e.message)); }} />}
          {booking.checkoutExpiresAt && <p className="text-xs">Complete payment by {displayTime(booking.checkoutExpiresAt)}. If you just paid, your payment status will update automatically.</p>}
        </> : <p className="text-sm leading-relaxed">Your deposit is paid. The studio will review your request; no further deposit is needed.</p>}
        <p className="text-xs leading-relaxed">Approval required by {displayTime(booking.approvalBy)}. Your session is confirmed after studio approval.</p>
      </section>}
      <p className="text-xs leading-relaxed">For artist cancellations, your deposit {booking.refundable ? `becomes nonrefundable at ${displayTime(booking.cancellationDeadline)}` : "is nonrefundable"}. Changes do not reset a nonrefundable deposit. Excess payment for a completed, shortened session is refunded manually.</p>
      {booking.proposal && <section className="booking-notice space-y-3">
        <h2 className="text-lg">Change awaiting approval</h2><p>{displayTime(booking.proposal.slot.start)}<br />to {displayTime(booking.proposal.slot.end)}</p>
        <p>New total: {money(booking.proposal.pricing.total)}. Deposit unchanged.</p><p>The original reservation remains in place. Decision due by {displayTime(new Date(booking.proposal.expiresAt).toISOString())}.</p>
        {staff ? <div className="flex gap-3"><button disabled={busy} onClick={() => mutate("approve_change")} className="action-button">Approve change</button><button disabled={busy} onClick={() => mutate("decline_change")} className="action-button">Decline change</button></div> : <button disabled={busy} className="underline" onClick={() => mutate("withdraw_change")}>Withdraw change request</button>}
      </section>}
      {!staff && booking.canModify && <>
        <ChangeBooking key={`${booking.slot.start}:${booking.slot.end}:${booking.slot.room}`} booking={booking} credential={credential} busy={busy} onSubmit={slot => mutate("change", { slot, termsVersion: TERMS_VERSION })} />
        {Date.parse(booking.now) < Date.parse(booking.slot.start) && <section className="space-y-3 border-t border-border pt-5">
          {!cancelReview ? <button className="text-sm underline" onClick={() => setCancelReview(true)}>Cancel this booking</button> : <><p className="text-sm">{booking.refundable ? `Cancellation currently qualifies for a manual refund of ${money(booking.depositPaid + booking.balancePaid - booking.refunded)} in verified payments.` : `Your original deposit is nonrefundable. Any overpayment will be reconciled manually.`} The rule is checked again when you confirm.</p><button disabled={busy} className="action-button" onClick={() => mutate("cancel")}>Confirm cancellation</button> <button onClick={() => setCancelReview(false)} className="text-sm underline">Keep booking</button></>}
        </section>}
      </>}
      {staff && <section className="space-y-5 border-t border-border pt-5">
        <h2 className="text-xl">Studio actions</h2>
        <p className="text-xs leading-relaxed">Deposits are recorded automatically by Stripe. Record other payments after receiving them. Issue deposit refunds in Stripe first, then record the refunded amount here.</p>
        <form onSubmit={recordPayment} className="space-y-4">
          <BookingInput id="payment-type" label="Record payment"><select id="payment-type" className="booking-input" value={paymentAction} onChange={e => setPaymentAction(e.target.value)}><option value="record_balance">Balance received</option><option value="record_refund">Refund issued</option></select></BookingInput>
          <BookingInput id="amount" label="Cumulative total for this payment category ($)" type="number" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
          <BookingInput id="payment-note" label="Transaction reference / verification note" required maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
          <PrimaryButton type="submit" disabled={busy}>Record verified amount</PrimaryButton>
        </form>
        <div className="flex flex-wrap gap-3">
          {booking.status === "pending" && <button className="action-button" disabled={busy || booking.depositPaid < booking.pricing.deposit || !!booking.proposal} onClick={() => mutate("approve")}>Approve booking</button>}
          {["pending", "confirmed"].includes(booking.status) && <button className="action-button" disabled={busy} onClick={() => { if (window.confirm("Decline this booking and release its time? All payments received will be owed back to the artist.")) void mutate("decline"); }}>Decline / studio cancellation</button>}
          {booking.status === "confirmed" && <button className="action-button" disabled={busy || Date.parse(booking.now) < Date.parse(booking.slot.end)} onClick={() => mutate("complete")}>Mark session completed</button>}
        </div>
      </section>}
    </>}
    <p className="text-xs text-secondary">Keep this link private. <Link className="underline" href="/">Back to Elysium</Link></p>
  </>;
  return staff ? <main className="management-shell mx-auto max-w-xl space-y-6 px-6 py-10">{content}</main> : <BookingLayout step={7} onBack={() => {}}><div className="guest-management flex flex-1 flex-col">{content}</div></BookingLayout>;
}
function ChangeBooking({ booking, credential, busy, onSubmit }: { booking: BookingView; credential: string; busy: boolean; onSubmit: (slot: Slot) => Promise<void> }) {
  const active = Date.parse(booking.now) >= Date.parse(booking.slot.start);
  const initialDay = new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(booking.slot.start));
  const [day, setDay] = useState(initialDay), [start, setStart] = useState(booking.slot.start);
  const [duration, setDuration] = useState(String((Date.parse(booking.slot.end) - Date.parse(booking.slot.start)) / 3600000));
  const [room, setRoom] = useState(booking.slot.room);
  const [quote, setQuote] = useState<{ total: number; slot: Slot } | null>(null), [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  async function preview(e: FormEvent) {
    e.preventDefault(); setError(""); setChecking(true); setQuote(null);
    try {
      const slot: Slot = { start: active ? booking.slot.start : start, end: new Date(Date.parse(active ? booking.slot.start : start) + Number(duration) * 3600000).toISOString(), room: active ? booking.slot.room : room };
      const result = await api("/api/quote", slot, credential); setQuote({ total: result.total, slot });
    } catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }
  return <details className="rounded-2xl border border-border p-5"><summary>{active ? "Extend your session" : "Request a change"}</summary>
    <form onSubmit={preview} onChange={() => setQuote(null)} className="mt-5 space-y-4">
      {!active && <><BookingInput id="change-day" label="New start date" type="date" required value={day} onChange={e => { setDay(e.target.value); setStart(""); }} /><BookingInput id="change-room" label="Room"><select id="change-room" className="booking-input" value={room} onChange={e => setRoom(e.target.value as Slot["room"])}>{ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></BookingInput></>}
      <TimeFields day={day} start={start} duration={duration} onStart={setStart} onDuration={setDuration} credential={credential} active={active} />
      <p className="text-xs leading-relaxed">Your original booking stays in place until approval. Extensions must be approved before the current session ends. The hourly rates and original deposit stay fixed.</p>
      {error && <p role="alert" className="text-xs">{error}</p>}
      <PrimaryButton type="submit" disabled={busy || checking}>{checking ? "Checking…" : "Check change"}</PrimaryButton>
      {quote && <div className="space-y-3"><p>New total: {money(quote.total)}. Deposit unchanged.</p><p className="text-xs">Submitting accepts the existing booking terms for these revised details.</p><PrimaryButton disabled={busy} onClick={async () => { await onSubmit(quote.slot); setQuote(null); }}>Request approval</PrimaryButton></div>}
    </form>
  </details>;
}
