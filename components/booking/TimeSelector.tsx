import { clockTime, timeOptionLabel } from "@/lib/booking-availability";

export function TimeSelector({ label, value, options, day, onChange, disabled = false }: { label: string; value: string; options: string[]; day: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [time, period] = value ? clockTime(value).split(" ") : [];
  return <div className={`time-selector grid${disabled ? " is-disabled" : ""}`}>
    <span className="time-display" aria-hidden="true">{value && <>{time}<br />{period}</>}</span>
    <select className="time-select" aria-label={`${label} time`} required value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>{label} time</option>
      {options.map(value => <option key={value} value={value}>{timeOptionLabel(value, day)}</option>)}
    </select>
  </div>;
}
