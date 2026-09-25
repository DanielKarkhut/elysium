"use client";
import { useEffect, useState } from "react";
import { MAXIMUM_SESSION_HOURS, STUDIO_TIME_ZONE } from "@/lib/booking-policy";
import { BookingInput } from "./BookingInput";
// Private capabilities are sent in headers, never in API URLs.
export async function api(path: string, body?: unknown, credential?: string) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed. Please try again.");
  return result;
}
export function TimeFields({ day, start, duration, onStart, onDuration, credential, active = false }: { day: string; start: string; duration: string; onStart: (value: string) => void; onDuration: (value: string) => void; credential?: string; active?: boolean }) {
  const [state, setState] = useState<{ day: string; starts: string[]; error: string }>({ day: "", starts: [], error: "" });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (active) return;
    let disposed = false;
    api(`/api/availability?day=${encodeURIComponent(day)}`, undefined, credential).then(result => {
      if (!disposed) setState({ day, starts: result.starts, error: "" });
    }).catch(e => { if (!disposed) setState({ day, starts: [], error: e.message }); });
    return () => { disposed = true; };
  }, [day, credential, active, reload]);
  return <div className="space-y-4">
    {!active && <><BookingInput id="start" label="Start time (New York)"><select id="start" className="booking-input" required value={start} onChange={e => onStart(e.target.value)} disabled={state.day !== day || !!state.error}>
      <option value="">{state.day !== day ? "Loading availability…" : "Choose a time"}</option>
      {start && !state.starts.includes(start) && <option value={start} disabled>Selected time — recheck availability</option>}
      {state.day === day && state.starts.map(value => <option key={value} value={value}>{new Date(value).toLocaleTimeString("en-US", { timeZone: STUDIO_TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</option>)}
    </select></BookingInput>
    {state.error && <p role="alert" className="text-xs">{state.error} <button type="button" className="underline" onClick={() => setReload(v => v + 1)}>Retry</button></p>}
    {!state.error && state.day === day && !state.starts.length && <p className="text-xs">No two-hour start times available. Try another day.</p>}</>}
    <BookingInput id="duration" label={active ? "New total session length (hours)" : "Session length (hours)"} type="number" min={2} max={MAXIMUM_SESSION_HOURS} step={0.5} required value={duration} onChange={e => onDuration(e.target.value)} />
  </div>;
}
