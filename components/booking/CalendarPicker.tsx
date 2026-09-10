import { dateKey, startOfDay } from "@/lib/booking";

type Props = { selected: Date | null; today: Date; month: Date; onMonthChange: (month: Date) => void; onSelect: (date: Date) => void; compact?: boolean };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CalendarPicker({ selected, today, month, onMonthChange, onSelect, compact = false }: Props) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  // Monday-first grid keeps September 9, 2026 correctly aligned to Wednesday.
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  const cells = Array.from({ length: count }, (_, i) => new Date(year, monthIndex, i - offset + 1));
  const selectedWeek = Math.floor((offset + (selected?.getDate() ?? 1) - 1) / 7);
  const compactStart = Math.max(0, Math.min(selectedWeek * 7, count - 28));
  const earliest = new Date(today.getFullYear(), today.getMonth(), 1);
  const latest = new Date(today.getFullYear() + 1, today.getMonth(), 1);

  return (
    <div className={`calendar-picker ${compact ? "calendar-compact" : ""}`}>
      {!compact && <div className="mb-3 flex items-center justify-between gap-2">
        <button className="calendar-arrow" aria-label="Previous month" disabled={month <= earliest} onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}>‹</button>
        <div className="flex items-center gap-3">
          <select aria-label="Month" className="calendar-month rounded-lg border border-border bg-transparent px-2 py-1" value={monthIndex} onChange={(event) => onMonthChange(new Date(year, Number(event.target.value), 1))}>
            {MONTHS.map((label, i) => <option key={label} value={i} disabled={new Date(year, i, 1) < earliest || new Date(year, i, 1) > latest}>{label}</option>)}
          </select>
          <span>{year}</span>
        </div>
        <button className="calendar-arrow" aria-label="Next month" disabled={month >= latest} onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}>›</button>
      </div>}
      {!compact && <div className="mb-1 grid grid-cols-7 text-center text-[9px] text-secondary" aria-hidden="true">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => <span key={day} className="py-2">{day}</span>)}
      </div>}
      <div className="grid grid-cols-7" role="group" aria-label={month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}>
        {(compact ? cells.slice(compactStart, compactStart + 28) : cells).map((date) => {
          const inMonth = date.getMonth() === monthIndex;
          const isSelected = !!selected && dateKey(date) === dateKey(selected);
          return <button key={dateKey(date)} type="button" className={`calendar-day ${isSelected ? "is-selected" : ""} ${!inMonth ? "other-month" : ""}`} disabled={!inMonth || date < startOfDay(today)} aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} aria-pressed={isSelected} aria-current={dateKey(date) === dateKey(today) ? "date" : undefined} onClick={() => onSelect(date)}>{date.getDate()}</button>;
        })}
      </div>
    </div>
  );
}
