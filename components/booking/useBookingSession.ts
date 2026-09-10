"use client";

import { useState, useSyncExternalStore } from "react";
import { createBookingSession } from "@/lib/booking-session-store";

const serverSnapshot = () => null;

export function useBookingSession() {
  const [session] = useState(createBookingSession);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, serverSnapshot);
  return { snapshot, update: session.update, reset: session.reset };
}
