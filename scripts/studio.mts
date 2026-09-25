import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../lib/server/db.ts";
import { load, save, staffLink, type BookingRecord } from "../lib/server/bookings.ts";
import { baseUrl } from "../lib/server/config.ts";
import { hash, token } from "../lib/server/security.ts";
import { instant, RATES, type Slot } from "../lib/booking-policy.ts";

const [command, argument] = process.argv.slice(2);
try {
  if (command === "list") {
    const result = await pool().query("SELECT id, data->>'reference' AS reference, data->>'status' AS status, data->'slot' AS slot FROM bookings ORDER BY created_at DESC LIMIT 100");
    console.table(result.rows);
  } else if (command === "link") {
    console.log(`${baseUrl()}/staff#${await staffLink(argument)}`);
  } else if (command === "rotate-links") {
    await transaction(async c => {
      const b = await load(c, argument);
      b.nonce = randomUUID();
      b.guestHash = hash(token(b.id, b.nonce, "guest"));
      b.staffHash = hash(token(b.id, b.nonce, "staff"));
      await save(c, b, "Private links replaced by the studio. Previous links are revoked.", "operator");
    });
    console.log("Links rotated; new links are queued for email delivery.");
  } else if (command === "jobs") {
    console.table((await pool().query("SELECT kind, count(*) AS pending, max(attempts) AS max_attempts FROM booking_jobs WHERE completed_at IS NULL GROUP BY kind")).rows);
  } else if (command === "release-block") {
    await transaction(async c => { const b = await load(c, argument); if (b.status !== "blocked") throw new Error("Only a manual block can be released here."); b.status = "declined"; await save(c, b, "Manual block released.", "operator"); });
  } else if (command === "import-blocks") {
    // JSON entries: { id: UUID, start: ISO timestamp with offset, end: ISO timestamp with offset, note: string }.
    // Stable IDs make rerunning the import safe. These blocks protect existing calendar sessions.
    const entries = JSON.parse(await readFile(argument, "utf8"));
    if (!Array.isArray(entries)) throw new Error("Expected an array of blocks.");
    await transaction(async c => {
      for (const entry of entries) {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(entry.id)) throw new Error("Each block needs a stable UUID id.");
        const slot: Slot = { start: instant(entry.start).toString(), end: instant(entry.end).toString(), room: "studio" };
        if (Date.parse(slot.end) <= Date.parse(slot.start)) throw new Error("Block end must follow start.");
        const existing = await c.query("SELECT request_hash FROM bookings WHERE id=$1", [entry.id]);
        if (existing.rowCount) {
          if (existing.rows[0].request_hash !== hash(JSON.stringify(entry))) throw new Error("An imported ID already exists with different details. Review the existing block before importing.");
          continue;
        }
        const nonce = randomUUID(), now = Date.now();
        const b: BookingRecord = { id: entry.id, reference: `BLOCK-${entry.id.slice(0, 8)}`, version: 0,
          customer: { artist: String(entry.note ?? "Manual block").slice(0, 80), email: "", phone: "" }, slot, proposal: null,
          status: "blocked", rates: { ...RATES }, taxBps: 0, depositDue: 0, depositPaid: 0, balancePaid: 0, refunded: 0,
          nonrefundable: false, cancellationRefundable: false, approvalBy: now,
          createdAt: now, termsVersion: "manual-block", acceptedAt: now, nonce, testMode: process.env.BOOKING_MODE === "test",
          guestHash: hash(token(entry.id, nonce, "guest")), staffHash: hash(token(entry.id, nonce, "staff")) };
        await c.query("INSERT INTO bookings(id,request_key,request_hash,email,data) VALUES($1,$1,$2,'',$3)", [b.id, hash(JSON.stringify(entry)), JSON.stringify(b)]);
        await save(c, b, "Manual schedule block imported.", "operator");
      }
    });
    console.log("Blocks imported. Overlapping imports roll back atomically.");
  } else throw new Error("Usage: npm run studio -- list | link <booking-id> | rotate-links <booking-id> | jobs | import-blocks <file.json> | release-block <id>");
} finally { await pool().end(); }
