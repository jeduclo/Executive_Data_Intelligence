import "server-only";
import { Pool, types, type PoolClient } from "pg";

// Return numbers as numbers and dates as plain "YYYY-MM-DD" strings (no timezone shifts)
types.setTypeParser(20, (v) => parseInt(v, 10)); // int8
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
types.setTypeParser(1082, (v) => v); // date

const g = globalThis as unknown as { __haldenPool?: Pool };

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: local ? undefined : { rejectUnauthorized: true },
  });
}

export function pool(): Pool {
  if (!g.__haldenPool) g.__haldenPool = makePool();
  return g.__haldenPool;
}

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

const ROLE_RE = /^rpt_[a-z_]+$/;

/**
 * Run queries as a persona. Everything happens inside one read-only transaction:
 *   SET LOCAL ROLE  -> column-level grants of that role apply
 *   app.user_id     -> row-level security policies resolve that user's sites
 * Both settings vanish at COMMIT, so pooled connections never leak identity.
 */
export async function asPersona<T>(userId: string, role: string, fn: (q: Query) => Promise<T>): Promise<T> {
  if (!ROLE_RE.test(role)) throw new Error("invalid role");
  const client: PoolClient = await pool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const q: Query = async (sql, params) => (await client.query(sql, params as unknown[])).rows;
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Queries the portal's own login may run (only sec.list_personas is granted). */
export async function asPortal<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const r = await pool().query(sql, params as unknown[]);
  return r.rows as T[];
}
