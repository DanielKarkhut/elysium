import { formatDate, formatTime, getPricing, money, type Booking } from "@/lib/booking";
import { useState } from "react";

export function BookingSummary({ booking }: { booking: Booking }) {
  const pricing = getPricing(booking);
  const [showFees, setShowFees] = useState(false);
  return <div className="booking-summary">
    <dl className="summary-details flex flex-col">
      <div><dt className="summary-label">Booking</dt><dd>{pricing.room.name}</dd></div>
      <div><dt className="summary-label">For</dt><dd>{pricing.hours} {pricing.hours === 1 ? "hour" : "hours"}</dd></div>
      <div><dt className="summary-label">From</dt><dd className="whitespace-nowrap">{formatTime(booking.start)} - {formatTime(booking.end)}</dd><dd className="mt-2 text-[10px] text-secondary">{formatDate(booking.date)}{booking.end >= 1440 ? " · Ends next day" : ""}</dd></div>
      <div><dt className="text-[13px]">At</dt><dd>${pricing.room.hourlyRate}/hour</dd></div>
    </dl>
    <div className="summary-total">
      <div className="flex items-baseline gap-3"><span className="text-[22px] tracking-[0.4em]">Total</span><button className="min-h-8 text-[9px]" aria-label="Price breakdown" aria-expanded={showFees} onClick={() => setShowFees(!showFees)}>with fees</button></div>
      <p className="text-[24px] leading-tight">{money(pricing.total)}</p>
      {showFees && <div className="price-details mt-2 text-[9px] text-secondary">
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2 gap-y-2 leading-relaxed">
          <dt>Studio time</dt><dd>{money(pricing.subtotal)}</dd>
          <dt>Mock fees (6.92%)</dt><dd>{money(pricing.fees)}</dd>
          <dt>50% deposit today</dt><dd>{money(pricing.deposit)}</dd>
          <dt>Remaining balance</dt><dd>{money(pricing.balance)}</dd>
        </dl>
      </div>}
    </div>
  </div>;
}
