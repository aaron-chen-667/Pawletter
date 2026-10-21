import pg from 'pg';
import { readFile } from 'node:fs/promises';
export const schema = () => readFile(new URL('./schema.sql', import.meta.url), 'utf8');
export function connectDatabase(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString: env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
}
export async function transaction(db, fn) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
export async function migrate(db) {
  // Serialize migrations across Cloud Run instances. DDL and its lock share one connection.
  await transaction(db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(73021422)');
    await client.query(await schema());
  });
}
