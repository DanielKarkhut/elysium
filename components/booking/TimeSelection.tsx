"use client";

import { useEffect, useState, type FormEvent } from "react";
import { dateHeading, type AvailableTimes } from "@/lib/booking-availability";
import { MAXIMUM_SESSION_HOURS } from "@/lib/booking-policy";
import type { BookingDraft } from "@/lib/booking-session";
import { TimeSelector } from "./TimeSelector";
import { PrimaryButton } from "./PrimaryButton";
import { api } from "./TimeFields";

export function UsageGuidance() {
  return <p className="usage-guidance text-center text-secondary">New York time · Open 24/7<br />2–{MAXIMUM_SESSION_HOURS} hours · 30 minute increments<br />Same-day requests require approval before they start.</p>;
}

export function TimeSelection({ draft, update, busy, onReview }: { draft: BookingDraft; update: (patch: Partial<BookingDraft>) => void; busy: boolean; onReview: (event: FormEvent) => void }) {
  const [state, setState] = useState<AvailableTimes & { day: string; error: string }>({ day: "", starts: [], endsByStart: {}, error: "" });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let disposed = false;
    api(`/api/availability?day=${encodeURIComponent(draft.date)}`).then(result => {
      if (!disposed) setState({ day: draft.date, starts: result.starts, endsByStart: result.endsByStart, error: "" });
    }).catch(error => { if (!disposed) setState({ day: draft.date, starts: [], endsByStart: {}, error: error.message }); });
    return () => { disposed = true; };
  }, [draft.date, reload]);
  const loading = state.day !== draft.date;
  const starts = !loading && !state.error ? state.starts : [];
  const start = starts.includes(draft.start) ? draft.start : "";
  const options = start ? state.endsByStart[start] ?? [] : [];
  const hours = Number(draft.duration);
  const endTime = start && hours >= 2 && hours <= MAXIMUM_SESSION_HOURS ? Date.parse(start) + hours * 3600000 : NaN;
  const candidate = Number.isFinite(endTime) ? new Date(endTime).toISOString() : "";
  const end = options.includes(candidate) ? candidate : "";

  return <form onSubmit={event => { if (!start || !end) event.preventDefault(); else onReview(event); }} className="time-step flex flex-1 flex-col">
    <h1 className="text-center">
      <span className="block text-[17px] leading-tight text-secondary">Booking starts on</span>
      <span className="date-heading mt-2 block">{dateHeading(draft.date)}</span>
    </h1>
    <h2 className="book-from text-center">Book<br />from</h2>
    <div className="time-controls grid grid-cols-[1fr_auto_1fr] items-center gap-5 px-2">
      <TimeSelector label="Start" value={start} options={starts} day={draft.date} disabled={!starts.length} onChange={value => update({ start: value, duration: "" })} />
      <span className="text-[32px]">To</span>
      <TimeSelector label="End" value={end} options={options} day={draft.date} disabled={!start} onChange={value => update({ duration: String((Date.parse(value) - Date.parse(start)) / 3600000) })} />
    </div>
    {loading ? <p role="status" className="booking-notice mt-8">Loading availability…</p> : state.error ? <p role="alert" className="booking-notice mt-8">{state.error} <button type="button" className="underline" onClick={() => setReload(n => n + 1)}>Retry</button></p> : !starts.length && <div className="booking-notice mt-8 text-center"><p>No two-hour sessions available. Choose another date.</p><PrimaryButton className="mt-5" onClick={() => update({ step: 2 })}>Change date</PrimaryButton></div>}
    {end && <PrimaryButton type="submit" className="review-button" disabled={busy}>{busy ? "Checking…" : "Review"}</PrimaryButton>}
    <UsageGuidance />
  </form>;
}
