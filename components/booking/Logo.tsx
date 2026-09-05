import Image from "next/image";

export function Logo({ landing = false }: { landing?: boolean }) {
  return (
    <div className={landing ? "logo logo-landing" : "logo logo-booking"} aria-label={landing ? "Elysium" : "Elysium booking"}>
      <Image src="/elysium_v1/logos/elysium_logo_no_words.png" width={600} height={600} alt="" priority className="logo-mark mix-blend-multiply" />
      <span aria-hidden="true" className="logo-word">{landing ? "elysium" : "booking"}</span>
    </div>
  );
}
