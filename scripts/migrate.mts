import { readFile, readdir } from "node:fs/promises";
import { pool } from "../lib/server/db.ts";
const client = await pool().connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(724019263)");
  await client.query("CREATE TABLE IF NOT EXISTS booking_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter(n => n.endsWith(".sql")).sort()) {
    if ((await client.query("SELECT 1 FROM booking_migrations WHERE name=$1", [name])).rowCount) continue;
    await client.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    await client.query("INSERT INTO booking_migrations(name) VALUES($1)", [name]);
    console.log(`Applied ${name}`);
  }
  await client.query("COMMIT");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool().end(); }
