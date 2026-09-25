import { useState } from "react";
import { money, ROOMS } from "@/lib/booking";
import { clockTime, dateHeading } from "@/lib/booking-availability";
import { studioDate, type Price, type Slot } from "@/lib/booking-policy";

export function BookingSummary({ slot, pricing }: { slot: Slot; pricing: Price }) {
  const [showFees, setShowFees] = useState(false);
  const room = ROOMS.find(r => r.id === slot.room)!;
  const hours = (Date.parse(slot.end) - Date.parse(slot.start)) / 3600000;
  const day = studioDate(Date.parse(slot.start));
  const lastDay = studioDate(Date.parse(slot.end));
  return <div className="booking-summary">
    <dl className="summary-details flex flex-col">
      <div><dt className="summary-label">Booking</dt><dd>{room.name}</dd></div>
      <div><dt className="summary-label">For</dt><dd>{hours} hours</dd></div>
      <div><dt className="summary-label">From</dt><dd className="summary-time">{clockTime(slot.start)} - {clockTime(slot.end)}</dd><dd className="mt-2 text-secondary">{dateHeading(day)}{lastDay !== day ? ` · Ends ${dateHeading(lastDay)}` : ""} · New York</dd></div>
      <div><dt className="text-[13px]">At</dt><dd>{money(pricing.subtotal / hours).replace(".00", "")}/hour</dd></div>
    </dl>
    <div className="summary-total">
      <div className="flex items-baseline gap-3"><span className="text-[22px] tracking-[0.4em]">Total</span><button type="button" className="min-h-8 text-[9px]" aria-label="Price breakdown" aria-expanded={showFees} onClick={() => setShowFees(!showFees)}>with tax</button></div>
      <p className="text-[24px] leading-tight">{money(pricing.total)}</p>
      {showFees && <dl className="booking-totals mt-3 text-secondary"><dt>Studio time</dt><dd>{money(pricing.subtotal)}</dd><dt>Tax</dt><dd>{money(pricing.tax)}</dd><dt>50% deposit</dt><dd>{money(pricing.deposit)}</dd><dt>Balance at session</dt><dd>{money(pricing.total - pricing.deposit)}</dd></dl>}
    </div>
  </div>;
}
