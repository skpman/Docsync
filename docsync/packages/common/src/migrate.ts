import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const defaultDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

/** Applies every *.sql file in the migrations folder that hasn't run yet, in name order. */
export async function migrate(dir = process.env.MIGRATIONS_DIR ?? defaultDir): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent migrators (api and sync may start together)
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
  return applied;
}
