import { runJobs } from "../lib/server/jobs.ts";
import { pool } from "../lib/server/db.ts";
try { console.log(await runJobs(20)); } finally { await pool().end(); }
