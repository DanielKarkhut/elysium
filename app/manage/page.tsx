import type { Metadata } from "next";
import { ManageBooking } from "@/components/booking/ManageBooking";
export const metadata: Metadata = { title: "Manage booking — Elysium", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <ManageBooking />; }
