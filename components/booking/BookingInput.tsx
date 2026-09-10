import type { InputHTMLAttributes, ReactNode } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; children?: ReactNode };

export function BookingInput({ label, error, children, id, ...props }: Props) {
  return (
    <div className="booking-field flex flex-col gap-2">
      <label htmlFor={id} className="text-left text-[13px] leading-tight">{label}</label>
      {children ?? <input id={id} className="booking-input" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...props} />}
      {error && <p id={`${id}-error`} className="field-error text-right text-[11px] leading-relaxed" role="alert">{error}</p>}
    </div>
  );
}
