import type { PGlite } from '@electric-sql/pglite';

import { LeaderboardStore } from '../../src/leaderboard/leaderboard.store';
import type { Score } from '../../src/leaderboard/score';
import { addUser, freshDb } from '../support/db';

const WEEK = '2026-W45';
const CO = 'leadliaison.com';
const score = (patch: Partial<Score> = {}): Score => ({
  name: 'Malik', xp: 100, level: 2, streak: 1, weekXp: 10, week: WEEK, avatar: 'bunny', ...patch,
});

let db: PGlite;
let store: LeaderboardStore;

beforeEach(async () => {
  db = await freshDb();
  store = new LeaderboardStore(db);
});
afterEach(() => db.close());

test('a submitted score shows on the board as me', async () => {
  const me = await addUser(db);
  await store.submit(me, CO, score({ name: 'Malik', xp: 260, level: 3, streak: 4, avatar: 'penguin' }));
  expect(await store.board(me, CO, 'all', WEEK)).toEqual([
    { rank: 1, name: 'Malik', level: 3, xp: 260, streak: 4, is_me: true, avatar: 'penguin', company: CO },
  ]);
});

test('submitting again replaces the row instead of adding one', async () => {
  const me = await addUser(db);
  await store.submit(me, CO, score({ xp: 100 }));
  await store.submit(me, CO, score({ xp: 300, name: 'Malik H' }));
  const rows = await store.board(me, CO, 'all', WEEK);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ xp: 300, name: 'Malik H' });
});

test('remove deletes my row', async () => {
  const me = await addUser(db);
  await store.submit(me, CO, score());
  await store.remove(me);
  expect(await store.board(me, CO, 'all', WEEK)).toEqual([]);
});

test('only players from my company are on my board', async () => {
  const me = await addUser(db);
  const rival = await addUser(db, 'x@other.com');
  await store.submit(me, CO, score({ name: 'Me' }));
  await store.submit(rival, 'other.com', score({ name: 'Rival', xp: 999 }));
  expect((await store.board(me, CO, 'all', WEEK)).map((r) => r.name)).toEqual(['Me']);
});

test('ranks by xp then name, shows the top 10 and me when I am below them', async () => {
  const me = await addUser(db);
  for (let i = 1; i <= 11; i++) await store.submit(await addUser(db), CO, score({ name: `P${String(i).padStart(2, '0')}`, xp: 1000 - i * 10 }));
  const tied = await addUser(db);
  await store.submit(tied, CO, score({ name: 'A tie', xp: 990 })); // same xp as P01, earlier name
  await store.submit(me, CO, score({ name: 'Me', xp: 5 }));

  const rows = await store.board(me, CO, 'all', WEEK);
  expect(rows.map((r) => [r.rank, r.name, r.is_me])).toEqual([
    [1, 'A tie', false], [2, 'P01', false], [3, 'P02', false], [4, 'P03', false], [5, 'P04', false],
    [6, 'P05', false], [7, 'P06', false], [8, 'P07', false], [9, 'P08', false], [10, 'P09', false],
    [13, 'Me', true],
  ]);
});

test('the week board ranks this week by week xp and leaves out older weeks', async () => {
  const me = await addUser(db);
  const lastWeek = await addUser(db);
  const busy = await addUser(db);
  await store.submit(me, CO, score({ name: 'Me', xp: 5000, weekXp: 20 }));
  await store.submit(busy, CO, score({ name: 'Busy', xp: 50, weekXp: 90 }));
  await store.submit(lastWeek, CO, score({ name: 'Old', weekXp: 500, week: '2026-W44' }));

  const rows = await store.board(me, CO, 'week', WEEK);
  expect(rows.map((r) => [r.rank, r.name, r.xp])).toEqual([[1, 'Busy', 90], [2, 'Me', 20]]);
});
