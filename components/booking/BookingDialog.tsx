import { useEffect, useRef, type ReactNode } from "react";
import { PrimaryButton } from "./PrimaryButton";

export function BookingDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="booking-dialog" aria-labelledby="dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="p-6 sm:p-8">
      <h2 id="dialog-title" className="mb-6 text-[24px] leading-tight">{title}</h2>
      <div className="space-y-4 text-[12px] leading-loose text-secondary">{children}</div>
      <PrimaryButton onClick={onClose} className="mt-8">Close</PrimaryButton>
    </div>
  </dialog>;
}
