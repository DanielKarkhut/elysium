import assert from "node:assert/strict";
import { test } from "node:test";
import { createBookingSession } from "../lib/booking-session-store.ts";
import { BOOKING_SESSION_KEY } from "../lib/booking-session.ts";
test("store persists the last keystroke synchronously and handles denied storage", () => {
  const values = new Map<string, string>();
  let denied = false;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { if (denied) throw new Error("denied"); values.set(k, v); }, removeItem: (k: string) => values.delete(k) };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  const store = createBookingSession(); const off = store.subscribe(() => {});
  try {
    store.update({ duration: "5" });
    assert.equal(JSON.parse(values.get(BOOKING_SESSION_KEY)!).draft.duration, "5");
    denied = true; store.update({ duration: "6" });
    assert.equal(store.getSnapshot()?.storageUnavailable, true);
    assert.equal(store.getSnapshot()?.draft.duration, "6");
    store.reset(); assert.equal(values.has(BOOKING_SESSION_KEY), false);
  } finally {
    off();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
