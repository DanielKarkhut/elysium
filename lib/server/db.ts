import "server-only";
import { Pool, type PoolClient } from "pg";
import { required } from "./config.ts";

const globalDb = globalThis as typeof globalThis & { bookingPool?: Pool };
export function pool() {
  return globalDb.bookingPool ??= new Pool({ connectionString: required("DATABASE_URL"), max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    // One shared physical studio. Serialize schedule decisions across app instances.
    await client.query("SELECT pg_advisory_xact_lock(724019261)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
