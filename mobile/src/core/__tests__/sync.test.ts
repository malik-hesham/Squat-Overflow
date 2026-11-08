// Cross-device sync on top of mocked storage and a small in-memory stand-in for the server's
// /sync and /me API: the outbox, the cursor pull, the merges and the backfill ids.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
const mockGetSession = jest.fn();
jest.mock('../session', () => ({ getSession: () => mockGetSession() }));

import { API_URL } from '../../../../extension/config.js';
import { dayKey, isoWeek } from '../shared';
import { getItem, removeItems } from '../storage';
import {
  PROGRESS_AT_KEY,
  SETTINGS_DIRTY_KEY,
  STORE_KEYS,
  appendLog,
  getActivity,
  getProfile,
  getSettings,
  readLog,
  saveSettings,
  setProfile,
  type LogEntry,
  type Profile,
  type Settings,
} from '../store';
import {
  BACKFILL_NAMESPACE,
  CURSOR_KEY,
  MAX_PUSH,
  OUTBOX_KEY,
  STATE_KEY,
  backfillId,
  enqueue,
  mergeLog,
  mergeProfile,
  patchGroups,
  readOutbox,
  readState,
  settingsFromServer,
  syncAccount,
  toEvent,
  type BreakEvent,
  type ServerProfile,
} from '../sync';
import { uuidv5 } from '../uuid';

const MIN = 60_000;
// Monday 9 Nov 2026, 10:00 local.
const MON_10 = new Date(2026, 10, 9, 10, 0).getTime();
const SESSION = { accessToken: 'tok', refreshToken: 'r', expiresAt: MON_10 + 3_600_000, user: { id: 'user-1', email: 'me@acme.com' } };

// ---- A small fake of the server's sync API ----

type Stored = BreakEvent & { seq: number };
let server: {
  events: Stored[];
  settings: Record<string, unknown>;
  fieldAt: Record<string, number>;
  version: number;
  progress: { badges: string[]; daily: unknown; weekly: unknown; at: number } | null;
  offline: boolean;
  refuse: ((path: string, body: any) => boolean) | null;
  calls: { method: string; path: string; body: any }[];
};

function resetServer() {
  server = { events: [], settings: {}, fieldAt: {}, version: 0, progress: null, offline: false, refuse: null, calls: [] };
}

function profileFor(day: string, week: string): ServerProfile {
  const ev = server.events;
  const last = ev.reduce<Stored | null>((m, e) => (!m || e.at > m.at ? e : m), null);
  const xpDays = new Set(ev.filter((e) => e.xp > 0).map((e) => e.day));
  return {
    xp: ev.reduce((n, e) => n + e.xp, 0),
    level: 1,
    levelName: 'Desk Potato',
    streak: xpDays.size ? 1 : 0,
    week,
    weekXp: ev.filter((e) => e.week === week).reduce((n, e) => n + e.xp, 0),
    day,
    todayBreaks: ev.filter((e) => e.day === day).length,
    breaks: ev.length,
    lastBreakAt: last?.at ?? null,
    lastBreakDay: last?.day ?? null,
    badges: server.progress?.badges ?? [],
    daily: server.progress?.daily ?? null,
    weekly: server.progress?.weekly ?? null,
  };
}

const json = (status: number, body?: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const fakeFetch = jest.fn(async (url: string, init: RequestInit = {}) => {
  if (server.offline) throw new TypeError('Network request failed');
  const method = init.method ?? 'GET';
  const [path, query = ''] = url.slice(API_URL.length).split('?');
  const q = Object.fromEntries(query.split('&').filter(Boolean).map((p) => p.split('=')));
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  server.calls.push({ method, path: url.slice(API_URL.length), body });
  if (server.refuse?.(path, body)) return json(400, { message: 'refused' });
  if (method === 'POST' && path === '/sync/breaks') {
    if (body.events.length > 200) return json(400);
    let accepted = 0;
    for (const e of body.events) {
      if (server.events.some((s) => s.id === e.id)) continue;
      server.events.push({ ...e, seq: server.events.length + 1 });
      accepted++;
    }
    return json(200, { accepted, profile: profileFor(q.day, q.week) });
  }
  if (method === 'GET' && path === '/sync/breaks') {
    const since = Number(q.since);
    const events = server.events.filter((e) => e.seq > since).slice(0, Number(q.limit));
    return json(200, { events, next: events.length ? events.at(-1)!.seq : since });
  }
  if (method === 'GET' && path === '/me/profile') return json(200, profileFor(q.day, q.week));
  if (path === '/me/settings') {
    if (method === 'PATCH') {
      let changed = false;
      for (const [k, v] of Object.entries(body.patch)) {
        if ((server.fieldAt[k] ?? 0) > body.at) continue;
        server.settings[k] = v;
        server.fieldAt[k] = body.at;
        changed = true;
      }
      if (changed) server.version++;
    }
    return json(200, { doc: { ...server.settings }, version: server.version });
  }
  if (method === 'PUT' && path === '/me/progress') {
    if (!server.progress || server.progress.at <= body.at) server.progress = body;
    return json(204);
  }
  return json(404);
});

const chromeEvent = (at: number, xp = 20, extra: Partial<BreakEvent> = {}): BreakEvent => ({
  id: require('node:crypto').randomUUID(),
  at,
  day: dayKey(at),
  week: isoWeek(at),
  device: 'chrome',
  reps: 18,
  moves: 3,
  score: 90,
  xp,
  scored: true,
  completed: true,
  areas: [],
  ...extra,
});

const entry = (at: number, xp = 15, extra: Partial<LogEntry> = {}): LogEntry => ({
  at,
  reps: 18,
  moves: 3,
  score: 80,
  xp,
  scored: true,
  completed: true,
  ...extra,
});

const pushes = () => server.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/sync/breaks'));

beforeEach(async () => {
  jest.useFakeTimers({ now: MON_10, doNotFake: ['nextTick', 'setImmediate'] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  resetServer();
  fakeFetch.mockClear();
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
  mockGetSession.mockResolvedValue(SESSION);
  await removeItems([
    ...STORE_KEYS.settings,
    STORE_KEYS.PROFILE_KEY,
    STORE_KEYS.LOG_KEY,
    STORE_KEYS.ACTIVITY_KEY,
    OUTBOX_KEY,
    CURSOR_KEY,
    STATE_KEY,
    SETTINGS_DIRTY_KEY,
    PROGRESS_AT_KEY,
  ]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---- Backfill ids ----

describe('backfill ids', () => {
  test('uuidv5 matches the RFC 4122 reference (Python uuid.uuid5)', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidv5('héllo ✓ 𝄞', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')).toBe('81bb52a4-bbfd-57a3-9a0c-0b5515020437');
    expect(uuidv5('player-1:1762682400000', BACKFILL_NAMESPACE)).toBe('c71b883a-6619-5b03-a1d0-947a6b80e4d1');
    expect(backfillId('player-1', 1762682400000)).toBe('c71b883a-6619-5b03-a1d0-947a6b80e4d1');
  });

  test('the first sync after sign-in uploads the old log once, with ids from playerId:at', async () => {
    const { playerId } = await getProfile();
    await appendLog(entry(MON_10 - 3 * 24 * 60 * MIN));
    await appendLog(entry(MON_10 - 24 * 60 * MIN, 0, { scored: false }));
    await appendLog(entry(MON_10 - 30 * MIN));

    expect((await syncAccount())?.ok).toBe(true);
    const log = await readLog();
    expect(log.map((e) => e.id)).toEqual(log.map((e) => backfillId(playerId, e.at)));
    expect(server.events.map((e) => e.id).sort()).toEqual(log.map((e) => e.id).sort());
    expect(server.events.every((e) => e.device === 'ios')).toBe(true);
    expect(await readOutbox()).toEqual([]);

    // Signing in again (same or another account) redoes the backfill: same ids, nothing new.
    await removeItems([STATE_KEY]);
    expect((await syncAccount())?.ok).toBe(true);
    expect(server.events).toHaveLength(3);
    expect((await readLog()).map((e) => e.id)).toEqual(log.map((e) => e.id));
  });

  test('a break logged with an id keeps it', async () => {
    const id = '2b0c7a77-6c1f-4a0e-9a3c-3c1d2b0a9f10';
    await appendLog(entry(MON_10 - 5 * MIN, 15, { id }));
    await syncAccount();
    expect(server.events.map((e) => e.id)).toEqual([id]);
  });

  test('nothing happens while signed out', async () => {
    mockGetSession.mockResolvedValue(null);
    await appendLog(entry(MON_10 - 5 * MIN));
    expect(await syncAccount()).toBeNull();
    expect(fakeFetch).not.toHaveBeenCalled();
    expect((await readState()).account).toBeNull();
  });
});

// ---- Outbox ----

describe('outbox', () => {
  const queued = (n: number, from = MON_10 - n * MIN) =>
    Array.from({ length: n }, (_, i) => toEvent({ ...entry(from + i * MIN), id: require('node:crypto').randomUUID() }));

  test('an id already waiting is not queued twice', async () => {
    const [a, b] = queued(2);
    await enqueue([a]);
    await enqueue([a, b, b]);
    expect((await readOutbox()).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  test('pushes in batches of at most 200 with this device and its local day and week', async () => {
    await syncAccount(); // signs in: nothing to backfill
    server.calls.length = 0;
    await enqueue(queued(450));
    await syncAccount();
    expect(pushes().map((c) => c.body.events.length)).toEqual([MAX_PUSH, MAX_PUSH, 50]);
    expect(pushes()[0].path).toBe(`/sync/breaks?day=2026-11-09&week=2026-W46`);
    expect(pushes()[0].body.events[0]).toMatchObject({ device: 'ios', day: dayKey(MON_10 - 450 * MIN), week: isoWeek(MON_10) });
    expect(server.events).toHaveLength(450);
    expect(await readOutbox()).toEqual([]);
  });

  test('offline keeps the queue; back online it uploads once', async () => {
    await syncAccount();
    const events = queued(3);
    await enqueue(events);
    server.offline = true;
    expect((await syncAccount())?.ok).toBe(false);
    expect(await readOutbox()).toHaveLength(3);
    server.offline = false;
    expect((await syncAccount())?.ok).toBe(true);
    await syncAccount();
    expect(server.events.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(await readOutbox()).toEqual([]);
  });

  test('a queued break the server would refuse is dropped instead of blocking the rest', async () => {
    await syncAccount();
    const [good] = queued(1);
    await enqueue([{ ...good, id: 'id-not-a-uuid' }, good]);
    await syncAccount();
    expect(server.events.map((e) => e.id)).toEqual([good.id]);
    expect(await readOutbox()).toEqual([]);
  });
});

// ---- Merges ----

describe('merge', () => {
  const profile = (over: Partial<Profile> = {}): Profile => ({
    playerId: 'p',
    secret: 's',
    xp: 0,
    streak: 0,
    lastStreakDay: null,
    lastBreakDay: null,
    weekXp: 0,
    week: null,
    badges: [],
    daily: null,
    weekly: null,
    ...over,
  });
  const serverProfile = (over: Partial<ServerProfile> = {}): ServerProfile => ({
    xp: 100,
    level: 2,
    levelName: 'Chair Escapee',
    streak: 3,
    week: '2026-W46',
    weekXp: 40,
    day: '2026-11-09',
    todayBreaks: 2,
    breaks: 9,
    lastBreakAt: MON_10 - MIN,
    lastBreakDay: '2026-11-09',
    badges: ['streak3'],
    daily: { day: '2026-11-09', ids: ['x'], areas: [], breaks: 2, run: 0, done: [] },
    weekly: null,
    ...over,
  });

  test('pulled breaks join the log once, in time order, marked with their device', () => {
    const mine = { ...entry(MON_10 - 10 * MIN), id: 'a' };
    const c = chromeEvent(MON_10 - 20 * MIN);
    const { log, added } = mergeLog([mine], [{ ...mine, ...toEvent(mine) }, c, c]);
    expect(added).toHaveLength(1);
    expect(log.map((e) => e.id)).toEqual([c.id, 'a']);
    expect(log[0]).toMatchObject({ device: 'chrome', xp: 20 });
  });

  test("the server's XP, streak and week win; unsent breaks are added back; badges are a union", () => {
    const unsent = [toEvent({ ...entry(MON_10, 12), id: 'u' })];
    const merged = mergeProfile(
      profile({ xp: 50, badges: ['first'], daily: null, lastStreakDay: '2026-11-06' }),
      serverProfile(),
      { unsent, log: [{ ...entry(MON_10, 12), id: 'u' }], keepLocalChallenges: false },
    );
    expect(merged).toMatchObject({ xp: 112, weekXp: 52, streak: 3, week: '2026-W46', lastBreakDay: '2026-11-09', lastStreakDay: '2026-11-09' });
    expect(merged.badges.sort()).toEqual(['first', 'streak3']);
    expect(merged.daily?.breaks).toBe(2);
  });

  test('local challenges stay while they have an unsent change', () => {
    const local = profile({ daily: { day: '2026-11-09', ids: ['y'], areas: [], breaks: 3, run: 1, done: [] } });
    const merged = mergeProfile(local, serverProfile(), { unsent: [], log: [], keepLocalChallenges: true });
    expect(merged.daily).toEqual(local.daily);
  });

  test("the server's settings apply except keys changed here and not sent yet", () => {
    const local = { intervalMin: 60, voice: true, name: 'Me', theme: 'dark' } as Settings;
    const patch = settingsFromServer(local, { intervalMin: 30, voice: true, name: 'Other', theme: 'light' }, { name: 1 });
    expect(patch).toEqual({ intervalMin: 30 }); // voice unchanged, name dirty, theme not shared
  });

  test('unsent changes go up grouped by when they were made', () => {
    const settings = { intervalMin: 45, voice: false, name: 'Me', theme: 'dark' } as Settings;
    expect(patchGroups({ name: 20, intervalMin: 10, voice: 10, theme: 5 }, settings)).toEqual([
      { at: 10, patch: { intervalMin: 45, voice: false } },
      { at: 20, patch: { name: 'Me' } },
    ]);
  });

  test('saving settings stamps only shared keys that really changed', async () => {
    await saveSettings({ intervalMin: 60, voice: false, theme: 'dark' }, 1234);
    expect(await getItem(SETTINGS_DIRTY_KEY)).toEqual({ voice: 1234 });
  });

  test('a local badge or challenge change is stamped; a copy of the server profile is not', async () => {
    const p = await getProfile();
    await setProfile({ ...p, xp: 5 }, { now: 1 });
    expect(await getItem(PROGRESS_AT_KEY)).toBeUndefined();
    await setProfile({ ...p, badges: ['first'] }, { now: 2 });
    expect(await getItem(PROGRESS_AT_KEY)).toBe(2);
    await setProfile({ ...p, badges: ['first', 'x'] }, { now: 3, fromServer: true });
    expect(await getItem(PROGRESS_AT_KEY)).toBe(2);
  });
});

// ---- A whole run ----

describe('sync run', () => {
  test('a break done in Chrome shows here and moves the shared timer', async () => {
    await appendLog({ ...entry(MON_10 - 60 * MIN, 15), id: '5f0e7c2a-1b1d-4c55-8b9e-0a1b2c3d4e5f' });
    server.events.push({ ...chromeEvent(MON_10 - 10 * MIN, 20), seq: 1 });
    const onRemoteBreak = jest.fn(async () => {});
    const result = await syncAccount({ onRemoteBreak });
    expect(result).toMatchObject({ ok: true, pushed: 1, pulled: 1, remoteBreakAt: MON_10 - 10 * MIN });
    expect(onRemoteBreak).toHaveBeenCalledWith(MON_10 - 10 * MIN);
    const log = await readLog();
    expect(log.map((e) => e.device ?? 'mine')).toEqual(['mine', 'chrome']);
    expect((await getActivity())?.[dayKey(MON_10)]).toEqual({ breaks: 2, xp: 35 });
    expect((await getProfile()).xp).toBe(35);
    expect(await getItem(CURSOR_KEY)).toBe(2);

    // Nothing new: no second reschedule.
    onRemoteBreak.mockClear();
    expect((await syncAccount({ onRemoteBreak }))?.pulled).toBe(0);
    expect(onRemoteBreak).not.toHaveBeenCalled();
  });

  test("this phone's own break coming back from the server doesn't move the timer", async () => {
    await appendLog({ ...entry(MON_10 - 5 * MIN), id: '5f0e7c2a-1b1d-4c55-8b9e-0a1b2c3d4e5f' });
    const onRemoteBreak = jest.fn(async () => {});
    const result = await syncAccount({ onRemoteBreak });
    expect(result?.remoteBreakAt).toBeUndefined();
    expect(onRemoteBreak).not.toHaveBeenCalled();
    expect(await readLog()).toHaveLength(1);
  });

  test('the cursor walks pages of 500', async () => {
    for (let i = 0; i < 700; i++) server.events.push({ ...chromeEvent(MON_10 - (800 - i) * MIN, 1), seq: i + 1 });
    const result = await syncAccount();
    expect(result?.pulled).toBe(700);
    const pulls = server.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/sync/breaks'));
    expect(pulls.map((c) => c.path)).toEqual(['/sync/breaks?since=0&limit=500', '/sync/breaks?since=500&limit=500']);
    expect(await readLog()).toHaveLength(500); // the log keeps the newest 500
  });

  test("first sync takes the account's settings and sends the ones it lacks; later changes go up", async () => {
    server.settings = { intervalMin: 30, areas: ['Neck tension'] };
    server.fieldAt = { intervalMin: MON_10 - 60 * MIN, areas: MON_10 - 60 * MIN };
    server.version = 1;
    await saveSettings({ intervalMin: 90, name: 'Phone me' });
    const onSettings = jest.fn(async () => {});

    await syncAccount({ onSettings });
    const local = await getSettings();
    expect(local.intervalMin).toBe(30);
    expect(local.areas).toEqual(['Neck tension']);
    expect(server.settings).toMatchObject({ intervalMin: 30, name: 'Phone me', mode: 'personal' });
    expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({ intervalMin: 90 }), expect.objectContaining({ intervalMin: 30 }));
    expect(await getItem(SETTINGS_DIRTY_KEY)).toEqual({});

    jest.setSystemTime(MON_10 + 5 * MIN);
    await saveSettings({ intervalMin: 45 });
    await syncAccount({ onSettings });
    const patch = server.calls.filter((c) => c.method === 'PATCH').at(-1);
    expect(patch?.body).toEqual({ patch: { intervalMin: 45 }, at: MON_10 + 5 * MIN });
    expect(server.settings.intervalMin).toBe(45);
    expect((await getSettings()).intervalMin).toBe(45);
  });

  test('another device changing a setting reaches this phone', async () => {
    await syncAccount();
    server.settings.voice = false;
    server.version++;
    const onSettings = jest.fn(async () => {});
    await syncAccount({ onSettings });
    expect((await getSettings()).voice).toBe(false);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  test('a refused settings change is dropped so it does not block the rest', async () => {
    await syncAccount();
    server.refuse = (path, body) => path === '/me/settings' && body?.patch && 'name' in body.patch;
    await saveSettings({ name: 'x'.repeat(60) });
    expect((await syncAccount())?.ok).toBe(true);
    expect(await getItem(SETTINGS_DIRTY_KEY)).toEqual({});
  });

  test('badges and challenges go up when changed here and come down when changed elsewhere', async () => {
    const p = await getProfile();
    await setProfile({ ...p, badges: ['first'] }, { now: MON_10 - MIN });
    await syncAccount();
    expect(server.progress).toMatchObject({ badges: ['first'], at: MON_10 - MIN });

    server.progress = { badges: ['first', 'streak3'], daily: { day: '2026-11-09', ids: [], areas: [], breaks: 1, run: 0, done: [] }, weekly: null, at: MON_10 };
    await syncAccount();
    const after = await getProfile();
    expect(after.badges).toEqual(['first', 'streak3']);
    expect(after.daily?.breaks).toBe(1);
    expect(await getItem(PROGRESS_AT_KEY)).toBe(MON_10 - MIN); // copying the server's isn't a local change
  });
});
