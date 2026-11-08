import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';

import { LeaderboardStore } from '../../src/leaderboard/leaderboard.store';
import { isoWeek } from '../../src/leaderboard/score';
import { addUser, freshDb } from '../support/db';

const sql = (name: string) => readFileSync(join(__dirname, '..', '..', 'scripts', name), 'utf8');
const CO = 'leadliaison.com';

let db: PGlite;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(() => db.close());

test('the demo seed fills the leadliaison.com board for this week, and is safe to run twice', async () => {
  const me = await addUser(db, 'me@leadliaison.com');
  await db.exec(sql('demo-seed.sql'));
  await db.exec(sql('demo-seed.sql'));
  const store = new LeaderboardStore(db);
  const all = await store.board(me, CO, 'all', isoWeek(new Date()));
  expect(all).toHaveLength(10); // top 10 of the 12 demo players; I have no row yet
  expect(all[0]).toMatchObject({ rank: 1, name: 'Omar Fathy', xp: 2140, level: 7, avatar: 'robot' });
  const week = await store.board(me, CO, 'week', isoWeek(new Date()));
  expect(week[0]).toMatchObject({ name: 'Nour Adel', xp: 214 });
});

test('the demo clear removes the demo players and nobody else', async () => {
  const me = await addUser(db, 'me@leadliaison.com');
  const store = new LeaderboardStore(db);
  await store.submit(me, CO, { name: 'Me', xp: 1, level: 1, streak: 0, weekXp: 1, week: isoWeek(new Date()), avatar: 'bunny' });
  await db.exec(sql('demo-seed.sql'));
  await db.exec(sql('demo-clear.sql'));
  expect((await store.board(me, CO, 'all', isoWeek(new Date()))).map((r) => r.name)).toEqual(['Me']);
  expect((await db.query('select count(*)::int as n from users')).rows[0]).toEqual({ n: 1 });
});
