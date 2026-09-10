import Image from "next/image";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import footerArtwork from "@/public/elysium_v1/images/elysium_high_res_footer.jpg";
import { Logo } from "./Logo";

const STEP_NAMES = ["Welcome", "Customer information", "Select a date", "Available time ranges", "Select your times", "Review booking", "Payment", "Booking confirmation"];

export function BookingLayout({ step, onBack, children }: { step: number; onBack: () => void; children: ReactNode }) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  return (
    <div className="booking-shell mx-auto flex w-full max-w-[390px] flex-col px-6 sm:max-w-[430px] sm:px-10" style={{ "--footer-image-ratio": footerArtwork.height / footerArtwork.width } as CSSProperties}>
      {step > 0 && (
        <header className="booking-header grid grid-cols-[36px_1fr_36px] items-start">
          {step < 7 ? <button className="back-button flex size-9 items-center justify-center rounded-full" onClick={onBack} aria-label="Go back">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          </button> : <span />}
          <Logo />
          <span />
        </header>
      )}
      <main ref={main} tabIndex={-1} aria-label={STEP_NAMES[step]} style={{ outline: "none" }} className={`booking-main flex flex-1 flex-col step-${step}`}>
        <span className="sr-only" aria-live="polite">Step {step + 1} of 8: {STEP_NAMES[step]}</span>
        {children}
      </main>
      <footer className="booking-footer">
        <Image src={footerArtwork} sizes="(max-width: 639px) 90vw, 350px" alt="Elysium. Sound Recording Field & Creative Abyss." className="h-auto w-full mix-blend-multiply" />
      </footer>
    </div>
  );
}
