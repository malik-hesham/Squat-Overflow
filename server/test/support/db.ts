import { PGlite } from '@electric-sql/pglite';

import type { Db } from '../../src/db/db';
import { migrate } from '../../src/db/migrate';

/** A fresh in-process Postgres with the app's schema applied. */
export async function freshDb(): Promise<PGlite & Db> {
  const db = new PGlite();
  await migrate(db);
  return db;
}

let n = 0;

/** Inserts a signed-in user directly and returns its id. */
export async function addUser(db: Db, email = `user${++n}@leadliaison.com`): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into users (google_sub, email) values ($1, $2) returning id`,
    [`sub-${++n}`, email],
  );
  return rows[0].id;
}
