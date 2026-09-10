"use client";

import { type FormEvent } from "react";
import { ROOMS, MINIMUM_MINUTES, formatDate, getAvailability, getPricing, isValidTimeRange, money, startOfDay, dateKey, timeOptions, type Booking, type Customer, type RoomId, type TimeRange } from "@/lib/booking";
import { AvailabilitySlot } from "./AvailabilitySlot";
import { BookingDialog } from "./BookingDialog";
import { BookingInput } from "./BookingInput";
import { BookingLayout } from "./BookingLayout";
import { BookingSummary } from "./BookingSummary";
import { CalendarPicker } from "./CalendarPicker";
import { Logo } from "./Logo";
import { PrimaryButton } from "./PrimaryButton";
import { TimeSelector } from "./TimeSelector";
import { BOOKING_TERMS_VERSION, bookingDetails, customerErrors, hasAcceptedTerms, parseBookingDate } from "@/lib/booking-session";
import { useBookingSession } from "./useBookingSession";

export function BookingFlow() {
  const { snapshot, update, reset } = useBookingSession();
  if (!snapshot) return <div role="status" className="p-8 text-center text-sm text-secondary">Restoring your booking…</div>;

  const { draft, notice, storageUnavailable } = snapshot;
  const { step, customer, start, end, dialog, reference } = draft;
  const today = startOfDay(new Date());
  const date = parseBookingDate(draft.date);
  const calendarMonth = parseBookingDate(draft.calendarMonth)!;
  const range = date ? getAvailability(date).find((item) => item.id === draft.rangeId) ?? null : null;
  const accepted = hasAcceptedTerms(draft);
  const errors = draft.validationAttempted ? customerErrors(customer) : {};
  const setStep = (next: number) => update({ step: next });
  const setDialog = (next: "info" | "terms" | null) => update({ dialog: next });

  const availability = date ? getAvailability(date) : [];
  const validTimes = !!range && isValidTimeRange(range, start, end);
  const booking: Booking | null = date && start !== null && end !== null && validTimes ? { customer, date, start, end } : null;

  function updateCustomer(field: keyof Customer, value: string) {
    update({ customer: { ...customer, [field]: value } });
  }

  function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = customerErrors(customer);
    if (Object.keys(nextErrors).length) {
      update({ validationAttempted: true });
      document.getElementById(Object.keys(nextErrors)[0])?.focus();
      return;
    }
    update({ customer: { ...customer, artist: customer.artist.trim(), email: customer.email.trim(), phone: customer.phone.trim() }, validationAttempted: false, step: 2 });
  }

  function chooseDate(next: Date) {
    const selectedDate = dateKey(next);
    update({ date: selectedDate, calendarMonth: dateKey(new Date(next.getFullYear(), next.getMonth(), 1)),
      ...(draft.date !== selectedDate ? { rangeId: null, start: null, end: null } : {}), step: 3 });
  }

  function chooseRange(next: TimeRange) {
    update({ rangeId: next.id, ...(draft.rangeId !== next.id ? { start: null, end: null } : {}), step: 4 });
  }

  function chooseStart(next: number) {
    update({ start: next, end: end !== null && end - next < MINIMUM_MINUTES ? null : end });
  }

  function goBack() {
    // Review and payment are the same screen; navigating back does not revoke consent.
    setStep(step === 6 ? 4 : Math.max(0, step - 1));
  }

  function finishDemoPayment() {
    if (!booking || !accepted) return;
    update({ reference: `ELY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, step: 7 });
  }

  return <>
    {(notice || storageUnavailable) && <p role="status" className="mx-auto max-w-[430px] px-6 pt-4 text-center text-[11px] text-secondary">
      {notice}{notice && storageUnavailable ? " " : ""}{storageUnavailable ? "Your browser cannot save this booking. Refreshing may lose your progress." : ""}
    </p>}
    <BookingLayout step={step} onBack={goBack}>
      {step === 0 && <div className="landing-content flex flex-1 flex-col items-center">
        <h1 className="sr-only">Elysium studio booking</h1>
        <Logo landing />
        <nav className="landing-nav flex items-center justify-center" aria-label="Get started">
          <button onClick={() => setDialog("info")}>Info</button>
          <span aria-hidden="true">|</span>
          <button onClick={() => setStep(1)}>Booking</button>
        </nav>
      </div>}

      {step === 1 && <form className="customer-form flex flex-1 flex-col" onSubmit={submitCustomer} noValidate>
        <h1 className="sr-only">Customer information</h1>
        <div className="customer-fields flex flex-col">
          <BookingInput id="room" label="Room to book" error={errors.room}>
            <select id="room" className="booking-input" value={customer.room} aria-invalid={!!errors.room} aria-describedby={errors.room ? "room-error" : undefined} required onChange={(event) => updateCustomer("room", event.target.value as RoomId)}>
              <option value="" disabled></option>
              {ROOMS.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select>
          </BookingInput>
          <BookingInput id="artist" label="Artist name" value={customer.artist} error={errors.artist} onChange={(event) => updateCustomer("artist", event.target.value)} autoComplete="nickname" maxLength={80} required />
          <BookingInput id="email" label="Email address" type="email" inputMode="email" value={customer.email} error={errors.email} onChange={(event) => updateCustomer("email", event.target.value)} autoComplete="email" maxLength={254} required />
          <BookingInput id="phone" label="Phone number" type="tel" inputMode="tel" value={customer.phone} error={errors.phone} onChange={(event) => updateCustomer("phone", event.target.value)} autoComplete="tel" maxLength={30} required />
        </div>
        <PrimaryButton type="submit" className="customer-next">Time selection</PrimaryButton>
      </form>}

      {step === 2 && <section className="calendar-step">
        <h1 className="sr-only">Select a booking date</h1>
        <CalendarPicker selected={date} today={today} month={calendarMonth} onMonthChange={(month) => update({ calendarMonth: dateKey(month) })} onSelect={chooseDate} />
        <p className="mt-5 text-center text-[10px] leading-relaxed text-secondary">Select a date to see availability</p>
      </section>}

      {step === 3 && date && <section className="availability-step">
        <CalendarPicker selected={date} today={today} month={new Date(date.getFullYear(), date.getMonth(), 1)} onMonthChange={(month) => update({ calendarMonth: dateKey(month) })} onSelect={chooseDate} compact />
        <h1 className="availability-heading text-center">
          <span className="block text-[17px] leading-tight">Time ranges<br />available for</span>
          <span className="date-heading mt-4 block">{formatDate(date)}</span>
        </h1>
        {availability.length ? <div className="availability-list flex flex-col">
          {availability.map((item) => <AvailabilitySlot key={item.id} range={item} onClick={() => chooseRange(item)} />)}
        </div> : <div className="mt-8 rounded-2xl border border-border px-5 py-7 text-center">
          <p className="text-[16px]">A quiet day.</p>
          <p className="mt-3 text-[11px] leading-loose text-secondary">The studio is closed on Sundays.<br />Choose another date for your session.</p>
          <PrimaryButton className="mt-6" onClick={() => setStep(2)}>Change date</PrimaryButton>
        </div>}
      </section>}

      {step === 4 && date && range && <section className="time-step flex flex-1 flex-col">
        <h1 className="text-center"><span className="block text-[17px] text-secondary">Available for</span><span className="date-heading mt-2 block">{formatDate(date)}</span></h1>
        <div className="time-availability-list flex flex-col">
          {availability.map((item) => <AvailabilitySlot key={item.id} range={item} selected={range.id === item.id} onClick={() => chooseRange(item)} />)}
        </div>
        <h2 className="book-from text-center">Book<br />from</h2>
        <div className="time-controls grid grid-cols-[1fr_auto_1fr] items-center gap-5 px-2">
          <TimeSelector label="Start" value={start} options={timeOptions(range.start, range.end - MINIMUM_MINUTES)} onChange={chooseStart} />
          <span className="text-[32px]">To</span>
          <TimeSelector label="End" value={end} options={timeOptions((start ?? range.start) + MINIMUM_MINUTES, range.end)} onChange={(value) => update({ end: value })} disabled={start === null} />
        </div>
        <p className="mt-3 text-center text-[9px] leading-relaxed text-secondary">1 hour minimum · 30 minute increments{end !== null && end >= 1440 ? <><br />Your session ends the next day</> : null}</p>
        {validTimes && <PrimaryButton className="review-button" onClick={() => setStep(accepted ? 6 : 5)}>Review</PrimaryButton>}
      </section>}

      {(step === 5 || step === 6) && booking && <section className="review-step flex flex-1 flex-col">
        <h1 className="screen-title text-center">Review</h1>
        <BookingSummary booking={booking} />
        <p className="deposit-note text-center">50% deposit charged at booking<br />Deposit will be forfeited in the<br />case of cancellation</p>
        <div className="terms-row flex items-center justify-center gap-2">
          <input id="terms" type="checkbox" aria-label="I accept the terms and conditions" checked={accepted} className="size-4 shrink-0 accent-primary" onChange={(event) => update({ acceptance: event.target.checked ? { version: BOOKING_TERMS_VERSION, details: bookingDetails(draft) } : null, step: event.target.checked ? 6 : 5 })} />
          <span className="text-[10px] leading-relaxed"><label htmlFor="terms">I accept the </label><button className="underline underline-offset-4" onClick={() => setDialog("terms")}>terms and conditions</button></span>
        </div>
        {step === 6 && <div className="payment-action">
          <PrimaryButton filled onClick={finishDemoPayment} aria-label="Simulate Apple Pay payment" className="payment-button">
            <span>Buy with</span>
            <span className="flex items-center gap-1"><svg aria-hidden="true" viewBox="0 0 24 28" width="15" height="18" fill="currentColor"><path d="M17.8 4.5c1-1.2 1.7-2.8 1.5-4.5-1.5.1-3.2 1-4.2 2.2-.9 1-1.8 2.7-1.5 4.3 1.6.1 3.2-.8 4.2-2ZM21.8 14.9c0-3 2.4-4.5 2.5-4.6-1.4-2.1-3.6-2.4-4.4-2.4-1.9-.2-3.7 1.1-4.7 1.1-1 0-2.5-1.1-4.1-1.1-2.1 0-4.1 1.2-5.2 3-2.2 3.8-.6 9.5 1.5 12.6 1 1.5 2.2 3.1 3.8 3 1.5-.1 2.1-1 4-1s2.4 1 4.1 1c1.7 0 2.7-1.5 3.7-3 1.2-1.7 1.7-3.4 1.7-3.5-.1 0-2.9-1.1-2.9-4.5Z" transform="translate(-3 0)" /></svg>Pay</span>
          </PrimaryButton>
          <p className="mt-2 text-center text-[8px] leading-relaxed text-secondary">Demo payment · {money(getPricing(booking).deposit)} deposit<br />No charge will be made</p>
        </div>}
      </section>}

      {step === 7 && booking && <section className="confirmation-step flex flex-1 flex-col">
        <h1 className="screen-title text-center">Booked</h1>
        <BookingSummary booking={booking} />
        <div className="confirmation-message text-center" role="status">
          <p className="text-[17px] leading-tight">Booking information<br />is ready for your<br />next studio session</p>
          <p className="mt-3 text-[9px] leading-relaxed text-secondary">Demo booking · {reference}</p>
          <p className="mt-2 text-[8px] leading-relaxed text-secondary">No payment was taken.<br />Email and SMS are not sent in this demo.</p>
        </div>
        <button className="mx-auto mt-5 min-h-9 text-[10px] underline underline-offset-4" onClick={reset}>Book another session</button>
      </section>}
    </BookingLayout>

    {dialog === "info" && <BookingDialog title="Space to create." onClose={() => setDialog(null)}>
      <p>Elysium — Sound Recording Field & Creative Abyss.</p>
      <p>Choose your room, find your time, and make something yours. Sessions start at $50 per hour, with a one hour minimum.</p>
      <p>This is a booking preview with mock availability and pricing. No reservation, payment, email, or text is sent.</p>
    </BookingDialog>}
    {dialog === "terms" && <BookingDialog title="Booking terms" onClose={() => setDialog(null)}>
      <p>A 50% deposit is due when booking. The remaining balance is due at the session. The deposit is forfeited if the booking is cancelled.</p>
      <p>Sessions have a one hour minimum and can be extended in 30 minute increments within the selected availability window.</p>
      <p>These are sample terms for this demo. Availability, fees, and payments are simulated. No real reservation is created.</p>
    </BookingDialog>}
  </>;
}
