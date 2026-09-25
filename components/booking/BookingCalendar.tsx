"use client";

import { useEffect, useRef, useState } from "react";
import { dateKey } from "@/lib/booking";
import { studioDate } from "@/lib/booking-policy";
import { CalendarPicker } from "./CalendarPicker";
import { api } from "./TimeFields";

export function BookingCalendar({ selected, month, onMonthChange, onSelect }: { selected: Date; month: Date; onMonthChange: (month: Date) => void; onSelect: (date: Date) => void }) {
  const monthKey = dateKey(month).slice(0, 7);
  const [state, setState] = useState<{ month: string; today: string; availableDates: string[]; error: string }>({ month: "", today: studioDate(), availableDates: [], error: "" });
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let request = 0;
    async function refresh() {
      const latest = ++request;
      try {
        const result = await api(`/api/availability?month=${monthKey}`);
        if (generation.current === current && latest === request) setState({ ...result, error: "" });
      } catch (error) {
        if (generation.current === current && latest === request) setState({ month: monthKey, today: studioDate(), availableDates: [], error: (error as Error).message });
      }
    }
    function refreshVisible() { if (document.visibilityState === "visible") void refresh(); }
    void refresh();
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      generation.current = current + 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [monthKey, reload]);
  const ready = state.month === monthKey && !state.error;
  async function chooseDate(date: Date) {
    const day = dateKey(date), current = generation.current;
    if (checking || !ready || !state.availableDates.includes(day)) return;
    setChecking(true); setNotice("");
    try {
      // Recheck on selection in case another artist booked since the month loaded.
      const result = await api(`/api/availability?day=${day}`);
      if (generation.current !== current) return;
      if (result.starts.length) onSelect(date);
      else {
        setState(previous => ({ ...previous, availableDates: previous.availableDates.filter(value => value !== day) }));
        setNotice("That date no longer has a two-hour session available. Choose another date.");
      }
    } catch (error) {
      if (generation.current === current) { setNotice((error as Error).message); setReload(value => value + 1); }
    } finally {
      if (generation.current === current) setChecking(false);
    }
  }
  return <>
    <CalendarPicker selected={selected} today={new Date(`${state.today}T12:00:00`)} month={month} availableDates={ready ? state.availableDates : []} busy={checking} onMonthChange={onMonthChange} onSelect={chooseDate} />
    {state.error && state.month === monthKey ? <p role="alert" className="booking-notice mt-5">{state.error} <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>Retry</button></p> : <p role="status" className="mt-5 text-center text-[10px] text-secondary">{checking ? "Checking selected date…" : !ready ? "Checking available dates…" : state.availableDates.length ? "Choose an available date · Unavailable dates are grayed out" : "No dates available this month. Try another month."}</p>}
    {notice && <p role="status" className="booking-notice mt-4">{notice}</p>}
  </>;
}
