import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKING_SESSION_KEY, BOOKING_SESSION_TTL, emptyBookingDraft, serializeBookingDraft } from "../lib/booking-session.ts";
import { createBookingSession } from "../lib/booking-session-store.ts";

test("browser session lifecycle", async (t) => {
  const values = new Map<string, string>();
  let blocked = false;
  const browser = new EventTarget();
  const documentTarget = new EventTarget();
  const storage = {
    getItem(key: string) { if (blocked) throw new Error("blocked"); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error("blocked"); values.set(key, value); },
    removeItem(key: string) { if (blocked) throw new Error("blocked"); values.delete(key); },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(browser, { sessionStorage: storage }) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentTarget });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  await t.test("writes each change immediately, renews on interaction, expires an open page", (t) => {
    values.clear();
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000000 });
    const session = createBookingSession();
    assert.equal(session.getSnapshot(), null);
    const unsubscribe = session.subscribe(() => {});
    t.after(unsubscribe);
    session.update({ step: 1, customer: { room: "", artist: "Last keystroke", email: "user@", phone: "" } });
    assert.equal(JSON.parse(values.get(BOOKING_SESSION_KEY)!).draft.customer.email, "user@");
    const firstExpiry = session.getSnapshot()!.expiresAt!;
    t.mock.timers.tick(BOOKING_SESSION_TTL - 1);
    session.update({ dialog: "info" });
    assert.ok(session.getSnapshot()!.expiresAt! > firstExpiry);
    t.mock.timers.tick(BOOKING_SESSION_TTL - 1);
    assert.equal(session.getSnapshot()!.draft.step, 1);
    t.mock.timers.tick(1);
    assert.equal(session.getSnapshot()!.draft.step, 0);
    assert.match(session.getSnapshot()!.notice!, /expired/);
    assert.equal(values.has(BOOKING_SESSION_KEY), false);
  });

  await t.test("refresh does not overwrite a saved draft or extend its deadline", (t) => {
    values.clear();
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000000 });
    const draft = { ...emptyBookingDraft(), step: 1, dialog: "info" as const };
    const raw = serializeBookingDraft(draft, Date.now() + 1000);
    values.set(BOOKING_SESSION_KEY, raw);
    const session = createBookingSession();
    const unsubscribe = session.subscribe(() => {});
    t.after(unsubscribe);
    assert.deepEqual(session.getSnapshot()!.draft, draft);
    assert.equal(values.get(BOOKING_SESSION_KEY), raw);
    t.mock.timers.tick(1000);
    assert.equal(session.getSnapshot()!.draft.step, 0);
  });

  await t.test("focus detects expiry even when background timers were suspended", (t) => {
    values.clear();
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000000 });
    const session = createBookingSession();
    const unsubscribe = session.subscribe(() => {});
    t.after(unsubscribe);
    session.update({ step: 1 });
    t.mock.timers.setTime(Date.now() + BOOKING_SESSION_TTL);
    browser.dispatchEvent(new Event("focus"));
    assert.equal(session.getSnapshot()!.draft.step, 0);
    assert.equal(values.has(BOOKING_SESSION_KEY), false);
  });

  await t.test("blocked storage leaves the form usable with a warning", (t) => {
    blocked = true;
    const session = createBookingSession();
    const unsubscribe = session.subscribe(() => {});
    t.after(() => { unsubscribe(); blocked = false; });
    session.update({ step: 1 });
    assert.equal(session.getSnapshot()!.draft.step, 1);
    assert.equal(session.getSnapshot()!.storageUnavailable, true);
    blocked = false;
    session.update({ dialog: "info" });
    assert.equal(session.getSnapshot()!.storageUnavailable, false);
    assert.equal(JSON.parse(values.get(BOOKING_SESSION_KEY)!).draft.step, 1);
  });

  await t.test("reset removes only this booking and clears its expiry timer", (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000000 });
    values.set("another-feature", "keep");
    const session = createBookingSession();
    const unsubscribe = session.subscribe(() => {});
    t.after(unsubscribe);
    session.update({ step: 1, dialog: "info" });
    session.reset();
    assert.equal(values.has(BOOKING_SESSION_KEY), false);
    assert.equal(values.get("another-feature"), "keep");
    assert.equal(session.getSnapshot()!.draft.dialog, null);
    t.mock.timers.tick(BOOKING_SESSION_TTL);
    assert.equal(session.getSnapshot()!.notice, null);
  });
});
