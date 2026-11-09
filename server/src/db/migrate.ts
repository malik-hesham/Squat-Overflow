import type { Db } from './db';
import { MIGRATIONS } from './migrations';

/** Arbitrary constant: every app instance takes this advisory lock, so only one migrates at a time. */
const LOCK_ID = 7_431_266;

/**
 * Applies the migrations `db` hasn't recorded yet, each in its own transaction. Pass a single
 * connection (not a pool), so the advisory lock and the statements share a session.
 */
export async function migrate(db: Db, migrations = MIGRATIONS): Promise<string[]> {
  await db.query(`select pg_advisory_lock(${LOCK_ID})`);
  try {
    await db.query(
      `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
    );
    const { rows } = await db.query<{ name: string }>(`select name from schema_migrations`);
    const done = new Set(rows.map((r) => r.name));
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.name)) continue;
      await db.query('begin');
      try {
        for (const sql of m.statements) await db.query(sql);
        await db.query(`insert into schema_migrations (name) values ($1)`, [m.name]);
        await db.query('commit');
      } catch (err) {
        await db.query('rollback');
        throw new Error(`migration ${m.name} failed: ${(err as Error).message}`);
      }
      applied.push(m.name);
    }
    return applied;
  } finally {
    await db.query(`select pg_advisory_unlock(${LOCK_ID})`);
  }
}
