/** End-to-end tests of the cross-device sync API: /sync/breaks and /me/*. */
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';

import { isoWeek } from '../../src/leaderboard/score';
import { utcDay } from '../../src/sync/sync.service';
import { call, startApi, type ApiServer } from '../support/api';
import { freshDb } from '../support/db';
import { NONCE, fakeGoogle } from '../support/google';

let db: PGlite;
let google: Awaited<ReturnType<typeof fakeGoogle>>;
let server: ApiServer;

beforeAll(async () => {
  google = await fakeGoogle();
  db = await freshDb();
  server = await startApi(db, google.keys);
});
afterAll(async () => {
  await server.app.close();
  await db.close();
});

const api = (method: string, path: string, body?: unknown, token?: string) =>
  call(`${server.url}${path}`, method, body, token ? { Authorization: `Bearer ${token}` } : {});

let n = 0;
async function signIn(email = `sync${++n}@acme.io`): Promise<string> {
  const res = await api('POST', '/auth/google', { id_token: await google.idToken({ sub: `sync-${email}`, email }), nonce: NONCE });
  expect(res.status).toBe(200);
  return res.body.access_token;
}

const now = new Date();
const TODAY = utcDay(now);
const WEEK = isoWeek(now);
const DAY_MS = 86_400_000;

function breakAt(at: number, patch: Record<string, unknown> = {}) {
  const d = new Date(at);
  return {
    id: randomUUID(),
    at,
    day: utcDay(d),
    week: isoWeek(d),
    device: 'chrome',
    reps: 24,
    moves: 4,
    score: 80,
    xp: 20,
    scored: true,
    completed: true,
    areas: ['Neck tension'],
    ...patch,
  };
}

describe('auth', () => {
  test('every route needs a bearer token', async () => {
    expect((await api('POST', '/sync/breaks', { events: [] })).status).toBe(401);
    expect((await api('GET', '/sync/breaks')).status).toBe(401);
    expect((await api('GET', '/me/profile')).status).toBe(401);
    expect((await api('GET', '/me/settings', undefined, 'bad')).status).toBe(401);
    expect((await api('PATCH', '/me/settings', {})).status).toBe(401);
    expect((await api('PUT', '/me/progress', {})).status).toBe(401);
  });
});

describe('breaks', () => {
  test('push is idempotent and returns the derived profile', async () => {
    const token = await signIn();
    const a = breakAt(Date.now() - 60_000);
    const b = breakAt(Date.now() - 30_000, { device: 'ios', xp: 15 });

    const first = await api('POST', `/sync/breaks?day=${TODAY}&week=${WEEK}`, { events: [a, b] }, token);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toBe(2);
    expect(first.body.profile).toMatchObject({ xp: 35, level: 1, weekXp: 35, todayBreaks: 2, breaks: 2, streak: 1 });
    expect(first.body.profile.lastBreakAt).toBe(b.at);

    const again = await api('POST', '/sync/breaks', { events: [a, b] }, token);
    expect(again.body).toMatchObject({ accepted: 0, profile: { xp: 35, breaks: 2 } });
  });

  test('a bad batch is refused whole', async () => {
    const token = await signIn();
    const res = await api('POST', '/sync/breaks', { events: [breakAt(Date.now()), { id: 'x' }] }, token);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('events[1]: invalid id');
    expect((await api('GET', '/me/profile', undefined, token)).body.breaks).toBe(0);
    expect((await api('POST', '/sync/breaks?day=yesterday', { events: [breakAt(Date.now())] }, token)).status).toBe(400);
  });

  test('pull walks the cursor in pages and sees only the caller’s breaks', async () => {
    const me = await signIn();
    const other = await signIn();
    const mine = Array.from({ length: 5 }, (_, i) => breakAt(Date.now() - (5 - i) * 1000, { device: i % 2 ? 'ios' : 'chrome' }));
    await api('POST', '/sync/breaks', { events: mine }, me);
    await api('POST', '/sync/breaks', { events: [breakAt(Date.now())] }, other);

    const page1 = await api('GET', '/sync/breaks?since=0&limit=3', undefined, me);
    expect(page1.status).toBe(200);
    expect(page1.body.events.map((e: { id: string }) => e.id)).toEqual(mine.slice(0, 3).map((e) => e.id));
    expect(page1.body.events[0]).toEqual({ ...mine[0], seq: expect.any(Number) });

    const page2 = await api('GET', `/sync/breaks?since=${page1.body.next}&limit=3`, undefined, me);
    expect(page2.body.events.map((e: { id: string }) => e.id)).toEqual(mine.slice(3).map((e) => e.id));

    const done = await api('GET', `/sync/breaks?since=${page2.body.next}`, undefined, me);
    expect(done.body).toEqual({ events: [], next: page2.body.next });

    expect((await api('GET', '/sync/breaks?limit=0', undefined, me)).status).toBe(400);
    expect((await api('GET', '/sync/breaks?since=-1', undefined, me)).status).toBe(400);
  });

  test('profile: total XP, level, week XP and a streak across days', async () => {
    const token = await signIn();
    // Breaks on the last 3 calendar days plus one 20 days ago. Every weekday is a workday, so
    // the last 3 days form a streak of 3 and the old one doesn't extend it.
    await api('PATCH', '/me/settings', { patch: { workdays: [0, 1, 2, 3, 4, 5, 6] }, at: Date.now() }, token);
    const events = [0, 1, 2, 20].map((d) => breakAt(Date.now() - d * DAY_MS, { xp: 100 }));
    await api('POST', '/sync/breaks', { events }, token);

    const p = (await api('GET', `/me/profile?day=${TODAY}&week=${WEEK}`, undefined, token)).body;
    expect(p).toMatchObject({ xp: 400, level: 3, levelName: 'Stretch Rookie', streak: 3, todayBreaks: 1, breaks: 4, day: TODAY, week: WEEK });
    expect(p.weekXp).toBe(events.filter((e) => e.week === WEEK).length * 100);
    expect(p.lastBreakDay).toBe(TODAY);
  });
});

describe('settings', () => {
  test('per-field last write wins by client time', async () => {
    const token = await signIn();
    const t0 = Date.now() - 10_000;
    const r1 = await api('PATCH', '/me/settings', { patch: { intervalMin: 30, voice: false }, at: t0 }, token);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ doc: { intervalMin: 30, voice: false }, version: 1 });

    // An older change from an offline device loses on intervalMin but sets a new key.
    const r2 = await api('PATCH', '/me/settings', { patch: { intervalMin: 90, memes: false }, at: t0 - 5000 }, token);
    expect(r2.body).toEqual({ doc: { intervalMin: 30, voice: false, memes: false }, version: 2 });

    // Nothing newer: no version bump.
    const r3 = await api('PATCH', '/me/settings', { patch: { intervalMin: 90 }, at: t0 - 1 }, token);
    expect(r3.body.version).toBe(2);

    const r4 = await api('PATCH', '/me/settings', { patch: { intervalMin: 45 }, at: t0 + 1 }, token);
    expect(r4.body).toEqual({ doc: { intervalMin: 45, voice: false, memes: false }, version: 3 });
    expect((await api('GET', '/me/settings', undefined, token)).body).toEqual(r4.body);
  });

  test('device-only keys are refused', async () => {
    const token = await signIn();
    const res = await api('PATCH', '/me/settings', { patch: { serverUrl: 'wss://evil' }, at: Date.now() }, token);
    expect(res.status).toBe(400);
    expect((await api('GET', '/me/settings', undefined, token)).body).toEqual({ doc: {}, version: 0 });
  });
});

describe('progress', () => {
  test('badges and challenges: a newer write wins, an older one is ignored', async () => {
    const token = await signIn();
    const t = Date.now();
    expect((await api('PUT', '/me/progress', { badges: ['variety'], daily: { id: 'variety' }, at: t }, token)).status).toBe(204);
    await api('PUT', '/me/progress', { badges: [], at: t - 1000 }, token);
    expect((await api('GET', '/me/profile', undefined, token)).body).toMatchObject({
      badges: ['variety'],
      daily: { id: 'variety' },
      weekly: null,
    });
    expect((await api('PUT', '/me/progress', { badges: 'x', at: t }, token)).status).toBe(400);
  });
});

describe('leaderboard', () => {
  test('competitive players get their board row from synced breaks; Personal removes it', async () => {
    const token = await signIn('ranked@board.io');
    await api('PATCH', '/me/settings', { patch: { mode: 'competitive', name: ' Ranked ', avatar: 'penguin' }, at: Date.now() }, token);
    await api('POST', '/sync/breaks', { events: [breakAt(Date.now(), { xp: 120 })] }, token);

    const board = await api('GET', '/leaderboard?period=all', undefined, token);
    expect(board.body).toEqual([
      { rank: 1, name: 'Ranked', level: 2, xp: 120, streak: 1, is_me: true, avatar: 'penguin', company: 'board.io' },
    ]);
    expect((await api('GET', '/leaderboard?period=week', undefined, token)).body).toEqual([
      expect.objectContaining({ xp: 120 }),
    ]);

    await api('PATCH', '/me/settings', { patch: { mode: 'personal' }, at: Date.now() + 1 }, token);
    expect((await api('GET', '/leaderboard?period=all', undefined, token)).body).toEqual([]);
  });

  test('personal-mode breaks never reach the board', async () => {
    const token = await signIn('quiet@board2.io');
    await api('POST', '/sync/breaks', { events: [breakAt(Date.now())] }, token);
    expect((await api('GET', '/leaderboard?period=all', undefined, token)).body).toEqual([]);
  });
});
