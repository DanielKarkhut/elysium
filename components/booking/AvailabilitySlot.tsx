import { formatTime, type TimeRange } from "@/lib/booking";

export function AvailabilitySlot({ range, selected = false, onClick }: { range: TimeRange; selected?: boolean; onClick: () => void }) {
  return <button type="button" className={`availability-slot w-full ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={onClick}>
    {formatTime(range.start)} - {formatTime(range.end)}
    {range.end >= 1440 && <span className="sr-only"> the next day</span>}
  </button>;
}
