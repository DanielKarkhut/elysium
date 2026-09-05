import { formatTime } from "@/lib/booking";

export function TimeSelector({ label, value, options, onChange, disabled = false }: { label: string; value: number | null; options: number[]; onChange: (value: number) => void; disabled?: boolean }) {
  return <div className="time-selector grid">
    <span className={`time-display ${value === null ? "text-secondary" : ""}`} aria-hidden="true">
      {value !== null ? <>{formatTime(value).split(" ")[0]}<br />{formatTime(value).split(" ")[1]}</> : <span className="text-[11px]">{label}</span>}
    </span>
    <select className="time-select" aria-label={`${label} time`} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
      <option value="" disabled>{label} time</option>
      {options.map((minutes) => <option key={minutes} value={minutes}>{formatTime(minutes)}{minutes >= 1440 ? " (+1 day)" : ""}</option>)}
    </select>
  </div>;
}
