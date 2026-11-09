// Cross-device sync with the server (docs/plans/cross-platform-sync.md, item 3).
//
// Every finished break is an immutable event with a client-made id. Breaks wait in an outbox
// (`syncOutbox`) until a push lands, so a retried upload never counts twice. A cursor pull
// (`syncCursor`) brings in breaks from the user's other devices. The server derives XP, level and
// streak from all events; this phone copies them. Shared settings merge per field, newest change
// wins; badges and challenges go up with PUT /me/progress.
//
// The engine owns the schedule and the profile, so it runs every local write through its queue
// (`exclusive`) and gets told when shared settings change or another device's break should move
// the next reminder. Network calls stay outside that queue.
import { Platform } from 'react-native';

import { API_URL } from '../../../extension/config.js';
import { getSession, type Session } from './session';
import { backfillActivity, dayKey, isoWeek, recordActivity } from './shared';
import { getItem, setItems } from './storage';
import {
  PROGRESS_AT_KEY,
  SETTINGS_DIRTY_KEY,
  SHARED_SETTINGS,
  getActivity,
  getProfile,
  getSettings,
  readLog,
  setActivity,
  setProfile,
  writeLog,
  type Activity,
  type LogEntry,
  type Profile,
  type Settings,
} from './store';
import { uuidv5 } from './uuid';

export const OUTBOX_KEY = 'syncOutbox';
export const CURSOR_KEY = 'syncCursor';
export const STATE_KEY = 'syncState';
/** Server limits: events per POST and per GET page. */
export const MAX_PUSH = 200;
export const PULL_LIMIT = 500;
/** Breaks kept waiting while signed out; older ones are still in the log for the backfill. */
const OUTBOX_MAX = 1000;
/** Namespace for ids of breaks logged before sync existed: UUIDv5 of `${playerId}:${at}`. */
// Same namespace as the extension (extension/lib/sync-core.js), so the rule is one everywhere.
export const BACKFILL_NAMESPACE = '240ab37e-ad3a-409a-a2f2-29f50c8e346d';
/** The server keeps `at` to the microsecond, but allow a little drift before calling a break someone else's. */
const SAME_BREAK_MS = 1_000;

export type Device = 'ios' | 'android';

export type BreakEvent = {
  id: string;
  at: number;
  day: string;
  week: string;
  device: string;
  reps: number;
  moves: number;
  score: number | null;
  xp: number;
  scored: boolean;
  completed: boolean;
  areas: string[];
};

export type PulledEvent = BreakEvent & { seq: number };

/** GET /me/profile, derived by the server from every device's breaks. */
export type ServerProfile = {
  xp: number;
  level: number;
  levelName: string;
  streak: number;
  week: string;
  weekXp: number;
  day: string;
  todayBreaks: number;
  breaks: number;
  lastBreakAt: number | null;
  lastBreakDay: string | null;
  badges: string[];
  daily: unknown;
  weekly: unknown;
};

type SettingsDoc = { doc: Record<string, unknown>; version: number };

/** What sync remembers per signed-in account. Nulls mean "not synced yet for this account". */
export type SyncState = {
  account: string | null;
  settingsVersion: number | null;
  progressSentAt: number | null;
  lastBreakAt: number | null;
};

const EMPTY_STATE: SyncState = { account: null, settingsVersion: null, progressSentAt: null, lastBreakAt: null };

export const thisDevice = (): Device => (Platform.OS === 'android' ? 'android' : 'ios');

export const backfillId = (playerId: string, at: number) => uuidv5(`${playerId}:${at}`, BACKFILL_NAMESPACE);

/** A log entry as the event the server stores; `day` and `week` are this phone's local keys. */
export function toEvent(entry: LogEntry & { id: string }, areas: string[] = [], device: string = thisDevice()): BreakEvent {
  return {
    id: entry.id,
    at: entry.at,
    day: dayKey(entry.at),
    week: isoWeek(entry.at),
    device,
    reps: entry.reps,
    moves: entry.moves,
    score: entry.score,
    xp: entry.xp,
    scored: entry.scored,
    completed: entry.completed,
    areas,
  };
}

// The server's checks (server/src/sync/validate.ts). One bad event refuses a whole batch, so bad
// ones are dropped here instead of blocking the outbox forever.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_AT = Date.UTC(2024, 0, 1);
const MAX_FUTURE_MS = 24 * 3_600_000;
const intIn = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function validEvent(e: BreakEvent, now = Date.now()): boolean {
  return (
    UUID_RE.test(e.id) &&
    intIn(e.at, MIN_AT, now + MAX_FUTURE_MS) &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.day) &&
    /^\d{4}-W\d{2}$/.test(e.week) &&
    intIn(e.reps, 0, 10_000) &&
    intIn(e.moves, 0, 100) &&
    (e.score === null || intIn(e.score, 0, 100)) &&
    intIn(e.xp, 0, 1_000) &&
    typeof e.scored === 'boolean' &&
    typeof e.completed === 'boolean' &&
    Array.isArray(e.areas) &&
    e.areas.length <= 20 &&
    e.areas.every((a) => typeof a === 'string' && a.length >= 1 && a.length <= 40)
  );
}

// ---- Outbox ----

export async function readOutbox(): Promise<BreakEvent[]> {
  const box = await getItem<BreakEvent[]>(OUTBOX_KEY);
  return Array.isArray(box) ? box : [];
}

/** Queues breaks for upload; an id already waiting is not queued twice. */
export async function enqueue(events: BreakEvent[]): Promise<void> {
  const box = await readOutbox();
  const waiting = new Set(box.map((e) => e.id));
  for (const e of events) {
    if (waiting.has(e.id)) continue;
    waiting.add(e.id);
    box.push(e);
  }
  await setItems({ [OUTBOX_KEY]: box.slice(-OUTBOX_MAX) });
}

async function dropFromOutbox(ids: Set<string>): Promise<void> {
  const box = await readOutbox();
  await setItems({ [OUTBOX_KEY]: box.filter((e) => !ids.has(e.id)) });
}

export async function readState(): Promise<SyncState> {
  return { ...EMPTY_STATE, ...(await getItem<Partial<SyncState>>(STATE_KEY)) };
}

async function patchState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await readState()), ...patch };
  await setItems({ [STATE_KEY]: next });
  return next;
}

/**
 * The first sync for an account gives every logged break an id (UUIDv5 of playerId:at, so doing
 * it again yields the same ids) and queues this phone's breaks for upload.
 */
export async function backfill(): Promise<number> {
  const [log, profile] = await Promise.all([readLog(), getProfile()]);
  let changed = false;
  const withIds = log.map((e) => {
    if (e.id) return e;
    changed = true;
    return { ...e, id: backfillId(profile.playerId, e.at) };
  }) as (LogEntry & { id: string })[];
  if (changed) await writeLog(withIds);
  const mine = withIds.filter((e) => !e.device);
  await enqueue(mine.map((e) => toEvent(e)));
  return mine.length;
}

// ---- Merges (pure) ----

/** Adds pulled breaks this phone doesn't have yet (by id) to its log, oldest first. */
export function mergeLog(log: LogEntry[], pulled: BreakEvent[]): { log: LogEntry[]; added: LogEntry[] } {
  const have = new Set(log.map((e) => e.id).filter(Boolean));
  const added: LogEntry[] = [];
  for (const e of pulled) {
    if (have.has(e.id)) continue;
    have.add(e.id);
    added.push({
      id: e.id,
      device: e.device,
      at: e.at,
      reps: e.reps,
      moves: e.moves,
      score: e.score,
      xp: e.xp,
      scored: e.scored,
      completed: e.completed,
    });
  }
  if (!added.length) return { log, added };
  return { log: [...log, ...added].sort((a, b) => a.at - b.at), added };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The server's value for every shared setting it has, unless this phone has an unsent change to it. */
export function settingsFromServer(local: Settings, doc: Record<string, unknown>, dirty: Record<string, number>): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const k of SHARED_SETTINGS) {
    if (!(k in doc) || k in dirty || same(local[k], doc[k])) continue;
    patch[k] = doc[k];
  }
  return patch as Partial<Settings>;
}

/** Unsent setting changes as PATCH bodies, one per change time, oldest first. */
export function patchGroups(dirty: Record<string, number>, settings: Settings): { at: number; patch: Record<string, unknown> }[] {
  const byAt = new Map<number, Record<string, unknown>>();
  for (const k of SHARED_SETTINGS) {
    const at = dirty[k];
    if (typeof at !== 'number') continue;
    byAt.set(at, { ...byAt.get(at), [k]: settings[k] });
  }
  return [...byAt.entries()].sort(([a], [b]) => a - b).map(([at, patch]) => ({ at, patch }));
}

const unionOf = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * The local profile with the server's numbers. Breaks still in the outbox aren't on the server
 * yet, so their XP is added back. Badges only ever grow, so both sides' are kept; challenges are
 * the server's unless this phone has a change it hasn't sent.
 */
export function mergeProfile(
  local: Profile,
  server: ServerProfile,
  { unsent, log, keepLocalChallenges }: { unsent: BreakEvent[]; log: LogEntry[]; keepLocalChallenges: boolean },
): Profile {
  const xpDays = log.filter((e) => e.xp > 0).map((e) => dayKey(e.at));
  if (local.lastStreakDay) xpDays.push(local.lastStreakDay);
  const latestXpDay = xpDays.length ? xpDays.reduce((a, b) => (a > b ? a : b)) : null;
  const unsentXp = unsent.reduce((n, e) => n + e.xp, 0);
  const unsentWeekXp = unsent.filter((e) => e.week === server.week).reduce((n, e) => n + e.xp, 0);
  return {
    ...local,
    xp: server.xp + unsentXp,
    streak: server.streak,
    weekXp: server.weekXp + unsentWeekXp,
    week: server.week,
    lastBreakDay: [server.lastBreakDay, local.lastBreakDay].reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null),
    lastStreakDay: server.streak > 0 ? latestXpDay : local.lastStreakDay,
    badges: unionOf(local.badges, server.badges ?? []),
    daily: keepLocalChallenges ? local.daily : (server.daily as Profile['daily']),
    weekly: keepLocalChallenges ? local.weekly : (server.weekly as Profile['weekly']),
  };
}

// ---- HTTP ----

export class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`sync ${status}`);
  }
}

async function call<T>(session: Session, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new SyncHttpError(res.status);
  return (res.status === 204 ? null : await res.json()) as T;
}

const refused = (err: unknown) => err instanceof SyncHttpError && err.status === 400;
const localKeys = (now: number) => `day=${dayKey(now)}&week=${isoWeek(now)}`;

// ---- The run ----

export type SyncHooks = {
  /** Runs local reads and writes one at a time with the engine's own changes. */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Shared settings changed on another device and were copied here. */
  onSettings?: (before: Settings, after: Settings) => Promise<void>;
  /** Another device finished a break after anything this phone has seen. */
  onRemoteBreak?: (at: number) => Promise<void>;
};

export type SyncResult = { ok: boolean; pushed: number; pulled: number; profile?: ServerProfile; remoteBreakAt?: number };

async function pushOutbox(session: Session): Promise<number> {
  let pushed = 0;
  for (let guard = 0; guard < 100; guard++) {
    const now = Date.now();
    const box = await readOutbox();
    if (!box.length) break;
    const bad = box.filter((e) => !validEvent(e, now));
    if (bad.length) {
      console.warn(`sync: dropping ${bad.length} invalid queued break(s)`);
      await dropFromOutbox(new Set(bad.map((e) => e.id)));
      continue;
    }
    const batch = box.slice(0, MAX_PUSH);
    try {
      await call(session, 'POST', `/sync/breaks?${localKeys(now)}`, { events: batch });
      pushed += batch.length;
    } catch (err) {
      if (!refused(err)) throw err;
      console.warn('sync: server refused a batch of breaks; dropping it', err);
    }
    await dropFromOutbox(new Set(batch.map((e) => e.id)));
  }
  return pushed;
}

async function pullBreaks(session: Session, exclusive: NonNullable<SyncHooks['exclusive']>): Promise<number> {
  let cursor = (await getItem<number>(CURSOR_KEY)) ?? 0;
  let added = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await call<{ events: PulledEvent[]; next: number }>(session, 'GET', `/sync/breaks?since=${cursor}&limit=${PULL_LIMIT}`);
    if (page.events.length) {
      added += await exclusive(async () => {
        const [log, activity] = await Promise.all([readLog(), getActivity()]);
        const merged = mergeLog(log, page.events);
        if (!merged.added.length) return 0;
        let act: Activity = activity ?? (backfillActivity(log) as Activity);
        for (const e of merged.added) act = recordActivity(act, e.at, e.xp) as Activity;
        await writeLog(merged.log);
        await setActivity(act);
        return merged.added.length;
      });
    }
    cursor = page.next;
    await setItems({ [CURSOR_KEY]: cursor });
    if (page.events.length < PULL_LIMIT) break;
  }
  return added;
}

async function syncSettings(session: Session, hooks: SyncHooks, exclusive: NonNullable<SyncHooks['exclusive']>): Promise<void> {
  const state = await readState();
  let doc: SettingsDoc | null = null;
  if (state.settingsVersion == null) {
    // First time for this account: the server's settings win where it has them (another
    // device set them up), and this phone's fill in the rest. They're stamped with the oldest
    // time the server takes, like the extension's seed, so any real change elsewhere wins.
    doc = await call<SettingsDoc>(session, 'GET', '/me/settings');
    const missing = SHARED_SETTINGS.filter((k) => !(k in doc!.doc));
    await setItems({ [SETTINGS_DIRTY_KEY]: Object.fromEntries(missing.map((k) => [k, MIN_AT])) });
  }
  const dirty = (await getItem<Record<string, number>>(SETTINGS_DIRTY_KEY)) ?? {};
  for (const { at, patch } of patchGroups(dirty, await getSettings())) {
    try {
      doc = await call<SettingsDoc>(session, 'PATCH', '/me/settings', { patch, at });
    } catch (err) {
      if (!refused(err)) throw err;
      console.warn('sync: server refused a settings change; dropping it', err);
    }
    // A key changed again while this was in flight keeps its newer stamp for the next run.
    const now = (await getItem<Record<string, number>>(SETTINGS_DIRTY_KEY)) ?? {};
    for (const k of Object.keys(patch)) if (now[k] === at) delete now[k];
    await setItems({ [SETTINGS_DIRTY_KEY]: now });
  }
  doc ??= await call<SettingsDoc>(session, 'GET', '/me/settings');
  const server = doc;
  const changed = await exclusive(async () => {
    const before = await getSettings();
    const stillDirty = (await getItem<Record<string, number>>(SETTINGS_DIRTY_KEY)) ?? {};
    const patch = settingsFromServer(before, server.doc, stillDirty);
    if (!Object.keys(patch).length) return null;
    await setItems(patch); // not saveSettings: this isn't a local change to send back
    const after = await getSettings();
    // Values that read back the same (an old area name maps to its current one) aren't a change.
    return SHARED_SETTINGS.some((k) => !same(before[k], after[k])) ? { before, after } : null;
  });
  await patchState({ settingsVersion: server.version });
  if (changed) await hooks.onSettings?.(changed.before, changed.after);
}

async function syncProfile(
  session: Session,
  exclusive: NonNullable<SyncHooks['exclusive']>,
): Promise<{ profile: ServerProfile; remoteBreakAt?: number }> {
  const now = Date.now();
  const server = await call<ServerProfile>(session, 'GET', `/me/profile?${localKeys(now)}`);
  const state = await readState();
  const local = await getProfile();
  const progressAt = (await getItem<number>(PROGRESS_AT_KEY)) ?? 0;
  const first = state.progressSentAt == null;
  const pending = progressAt > (state.progressSentAt ?? 0);
  const serverEmpty = !server.badges?.length && server.daily == null && server.weekly == null;
  const keepLocal = pending || (first && serverEmpty);
  const badges = unionOf(server.badges ?? [], local.badges);
  if (keepLocal || badges.length !== (server.badges ?? []).length) {
    const body = {
      badges,
      daily: keepLocal ? local.daily : server.daily,
      weekly: keepLocal ? local.weekly : server.weekly,
      at: pending ? progressAt : now,
    };
    try {
      await call(session, 'PUT', '/me/progress', body);
    } catch (err) {
      if (!refused(err)) throw err;
      console.warn('sync: server refused badges and challenges', err);
    }
  }
  await patchState({ progressSentAt: Math.max(progressAt, state.progressSentAt ?? 0) });

  const ownLast = await exclusive(async () => {
    const [mine, log, unsent, stampAt] = await Promise.all([getProfile(), readLog(), readOutbox(), getItem<number>(PROGRESS_AT_KEY)]);
    // A break finished while this ran has challenge changes the server hasn't seen yet.
    const keep = keepLocal || (stampAt ?? 0) > progressAt;
    await setProfile(mergeProfile(mine, server, { unsent, log, keepLocalChallenges: keep }), { fromServer: true });
    return log.filter((e) => !e.device).reduce((m, e) => Math.max(m, e.at), 0);
  });

  // One shared break timer: a break on another device, newer than any seen here, moves ours.
  const at = server.lastBreakAt;
  const seen = (await readState()).lastBreakAt ?? 0;
  if (at == null || at <= seen) return { profile: server };
  await patchState({ lastBreakAt: at });
  return { profile: server, remoteBreakAt: at > ownLast + SAME_BREAK_MS ? at : undefined };
}

async function runOnce(hooks: SyncHooks): Promise<SyncResult | null> {
  if (!API_URL) return null;
  const session = await getSession();
  const account = session?.user?.id ?? session?.user?.email;
  if (!session || !account) return null;
  const exclusive = hooks.exclusive ?? (<T>(fn: () => Promise<T>) => fn());
  const result: SyncResult = { ok: false, pushed: 0, pulled: 0 };
  try {
    if ((await readState()).account !== account) {
      await exclusive(backfill);
      await setItems({ [STATE_KEY]: { ...EMPTY_STATE, account }, [CURSOR_KEY]: 0 });
    }
    result.pushed = await pushOutbox(session);
    result.pulled = await pullBreaks(session, exclusive);
    await syncSettings(session, hooks, exclusive);
    const { profile, remoteBreakAt } = await syncProfile(session, exclusive);
    result.profile = profile;
    result.remoteBreakAt = remoteBreakAt;
    if (remoteBreakAt != null) await hooks.onRemoteBreak?.(remoteBreakAt);
    result.ok = true;
  } catch (err) {
    // Offline or the server is down: everything stays queued for the next run.
    if (!(err instanceof TypeError)) console.warn('sync failed', err);
  }
  return result;
}

let running: Promise<SyncResult | null> | null = null;
let again = false;

/**
 * Pushes queued breaks, pulls new ones, merges settings and copies the server's profile.
 * Resolves null when signed out. A call while one is running makes it go round once more, so a
 * break finished mid-sync still goes up.
 */
export function syncAccount(hooks: SyncHooks = {}): Promise<SyncResult | null> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result: SyncResult | null;
    do {
      again = false;
      result = await runOnce(hooks);
    } while (again && result?.ok);
    return result;
  })().finally(() => {
    running = null;
    again = false;
  });
  return running;
}
