import type { ButtonHTMLAttributes } from "react";

export function PrimaryButton({ children, className = "", filled = false, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { filled?: boolean }) {
  return <button type={type} className={`primary-button ${filled ? "primary-button-filled" : ""} ${className}`} {...props}>{children}</button>;
}
