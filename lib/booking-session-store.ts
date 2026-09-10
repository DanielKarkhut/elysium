import { BOOKING_SESSION_KEY, BOOKING_SESSION_TTL, emptyBookingDraft, restoreBookingDraft, serializeBookingDraft, updateBookingDraft, type BookingDraft } from "./booking-session.ts";

export type BookingSessionSnapshot = { draft: BookingDraft; expiresAt: number | null; storageUnavailable: boolean; notice: string | null };

// Created per mounted flow. Browser APIs are accessed only once React subscribes.
export function createBookingSession() {
  let snapshot: BookingSessionSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  function removeSaved() {
    try { window.sessionStorage.removeItem(BOOKING_SESSION_KEY); }
    catch { if (snapshot) snapshot = { ...snapshot, storageUnavailable: true }; }
  }

  function expire() {
    if (!snapshot?.expiresAt || Date.now() < snapshot.expiresAt) return false;
    snapshot = { ...snapshot, draft: emptyBookingDraft(), expiresAt: null, notice: "Your booking session expired after 20 minutes of inactivity. Please start again." };
    removeSaved();
    emit();
    return true;
  }

  function scheduleExpiry() {
    clearTimeout(timer);
    if (snapshot?.expiresAt && listeners.size) timer = setTimeout(() => {
      if (!expire()) scheduleExpiry();
    }, Math.max(0, snapshot.expiresAt - Date.now()));
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!snapshot) {
        snapshot = { draft: emptyBookingDraft(), expiresAt: null, storageUnavailable: false, notice: null };
        try {
          const raw = window.sessionStorage.getItem(BOOKING_SESSION_KEY);
          const restored = restoreBookingDraft(raw);
          if (restored) {
            snapshot = { ...snapshot, ...restored };
            // Remove legacy persisted consent without extending the existing deadline.
            const sanitized = serializeBookingDraft(restored.draft, restored.expiresAt);
            if (sanitized !== raw) window.sessionStorage.setItem(BOOKING_SESSION_KEY, sanitized);
          }
          else if (raw) {
            snapshot.notice = "Your saved booking expired or could not be restored. Please start again.";
            removeSaved();
          }
        } catch { snapshot = { ...snapshot, storageUnavailable: true }; }
        emit();
      }
      expire();
      scheduleExpiry();
      window.addEventListener("focus", expire);
      document.addEventListener("visibilitychange", expire);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(timer);
          window.removeEventListener("focus", expire);
          document.removeEventListener("visibilitychange", expire);
        }
      };
    },
    update(patch: Partial<BookingDraft>) {
      if (!snapshot || expire()) return;
      const draft = updateBookingDraft(snapshot.draft, patch);
      const expiresAt = Date.now() + BOOKING_SESSION_TTL;
      snapshot = { ...snapshot, draft, expiresAt, notice: null };
      // Persist synchronously with the interaction, including the final keystroke.
      try {
        window.sessionStorage.setItem(BOOKING_SESSION_KEY, serializeBookingDraft(draft, expiresAt));
        snapshot.storageUnavailable = false;
      } catch { snapshot.storageUnavailable = true; }
      scheduleExpiry();
      emit();
    },
    reset() {
      if (!snapshot) return;
      snapshot = { ...snapshot, draft: emptyBookingDraft(), expiresAt: null, notice: null };
      removeSaved();
      clearTimeout(timer);
      emit();
    },
  };
}
