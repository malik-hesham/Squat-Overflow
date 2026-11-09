/**
 * Input checks for the sync API. Clients compute XP and day keys; the server only range-checks
 * them, as the leaderboard does today.
 */

export const DEVICES = ['chrome', 'ios', 'android', 'mac', 'vscode'] as const;
export type Device = (typeof DEVICES)[number];

/** A finished break as clients upload it. `at` is epoch ms; `day` and `week` are the device's local keys. */
export interface BreakEvent {
  id: string;
  at: number;
  day: string;
  week: string;
  device: Device;
  reps: number;
  moves: number;
  score: number | null;
  xp: number;
  scored: boolean;
  completed: boolean;
  areas: string[];
}

export const MAX_PUSH = 200;
/** Breaks dated further ahead than this are refused (a device clock far in the future). */
export const MAX_FUTURE_MS = 24 * 3_600_000;
/** Nothing older than this: the oldest local logs predate sync by weeks, not years. */
const MIN_AT = Date.UTC(2024, 0, 1);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const WEEK_RE = /^\d{4}-W\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AVATAR_RE = /^[a-z]{2,20}$/;
const LANG_RE = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
// Weekly badges hold the area name (`weekly:Shoulder & rotator cuff`), so spaces and '&' are allowed, not at the ends.
const BADGE_RE = /^(?! )[A-Za-z0-9_.:& -]{1,60}(?<! )$/;

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const strIn = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const areaList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every((a) => strIn(a, 1, 40));

function checkEvent(e: unknown, now: number): string | null {
  if (!isObj(e)) return 'not an object';
  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'invalid id';
  if (!intIn(e.at, MIN_AT, now + MAX_FUTURE_MS)) return 'invalid at';
  if (typeof e.day !== 'string' || !DAY_RE.test(e.day)) return 'invalid day';
  if (typeof e.week !== 'string' || !WEEK_RE.test(e.week)) return 'invalid week';
  if (!DEVICES.includes(e.device as Device)) return 'invalid device';
  if (!intIn(e.reps, 0, 10_000) || !intIn(e.moves, 0, 100)) return 'invalid reps';
  if (e.score !== null && !intIn(e.score, 0, 100)) return 'invalid score';
  if (!intIn(e.xp, 0, 1_000)) return 'invalid xp';
  if (typeof e.scored !== 'boolean' || typeof e.completed !== 'boolean') return 'invalid flags';
  if (e.areas !== undefined && !areaList(e.areas)) return 'invalid areas';
  return null;
}

/** `{ events: BreakEvent[] }`, 1 to MAX_PUSH events. One bad event refuses the whole batch. */
export function validatePush(body: unknown, now = Date.now()): Check<BreakEvent[]> {
  if (!isObj(body) || !Array.isArray(body.events)) return { ok: false, error: 'events required' };
  const { events } = body;
  if (events.length < 1 || events.length > MAX_PUSH) return { ok: false, error: `1 to ${MAX_PUSH} events` };
  const out: BreakEvent[] = [];
  for (const [i, e] of events.entries()) {
    const err = checkEvent(e, now);
    if (err) return { ok: false, error: `events[${i}]: ${err}` };
    const ev = e as unknown as BreakEvent;
    out.push({ ...ev, id: ev.id.toLowerCase(), areas: ev.areas ?? [] });
  }
  return { ok: true, value: out };
}

/**
 * Settings every device shares, with a check per key. Device-only keys (serverUrl, setupDone,
 * theme, privacy, privacyStyle) are refused, so one device can't overwrite another's.
 */
export const SHARED_SETTINGS: Record<string, (v: unknown) => boolean> = {
  intervalMin: (v) => intIn(v, 1, 240),
  areas: areaList,
  activeStart: (v) => typeof v === 'string' && TIME_RE.test(v),
  activeEnd: (v) => typeof v === 'string' && TIME_RE.test(v),
  workdays: (v) => Array.isArray(v) && v.length <= 7 && new Set(v).size === v.length && v.every((d) => intIn(d, 0, 6)),
  autoPause: (v) => typeof v === 'boolean',
  voice: (v) => typeof v === 'boolean',
  memes: (v) => typeof v === 'boolean',
  mode: (v) => v === 'personal' || v === 'competitive',
  name: (v) => typeof v === 'string' && v.trim().length <= 40,
  avatar: (v) => typeof v === 'string' && AVATAR_RE.test(v),
  lang: (v) => typeof v === 'string' && LANG_RE.test(v),
  weekStart: (v) => intIn(v, 0, 6),
};

export interface SettingsPatch {
  patch: Record<string, unknown>;
  at: number;
}

/** `{ patch: { key: value, ... }, at }`; `at` is the client's epoch ms of the change. */
export function validateSettingsPatch(body: unknown, now = Date.now()): Check<SettingsPatch> {
  if (!isObj(body) || !isObj(body.patch)) return { ok: false, error: 'patch required' };
  if (!intIn(body.at, MIN_AT, now + MAX_FUTURE_MS)) return { ok: false, error: 'invalid at' };
  const keys = Object.keys(body.patch);
  if (keys.length === 0) return { ok: false, error: 'empty patch' };
  for (const k of keys) {
    const check = SHARED_SETTINGS[k];
    if (!check) return { ok: false, error: `unknown setting ${k}` };
    if (!check(body.patch[k])) return { ok: false, error: `invalid ${k}` };
  }
  return { ok: true, value: { patch: body.patch, at: body.at } };
}

export interface Progress {
  badges: string[];
  daily: unknown;
  weekly: unknown;
}

const MAX_CHALLENGE_JSON = 4_096;
const smallJson = (v: unknown) => v === null || (isObj(v) && JSON.stringify(v).length <= MAX_CHALLENGE_JSON);

/** `{ badges, daily, weekly, at }`: the extension profile's badge list and challenge objects. */
export function validateProgress(body: unknown, now = Date.now()): Check<Progress & { at: number }> {
  if (!isObj(body)) return { ok: false, error: 'invalid body' };
  if (!intIn(body.at, MIN_AT, now + MAX_FUTURE_MS)) return { ok: false, error: 'invalid at' };
  const { badges, daily = null, weekly = null } = body;
  if (!Array.isArray(badges) || badges.length > 200 || !badges.every((b) => typeof b === 'string' && BADGE_RE.test(b)))
    return { ok: false, error: 'invalid badges' };
  if (!smallJson(daily) || !smallJson(weekly)) return { ok: false, error: 'invalid challenges' };
  return { ok: true, value: { badges, daily, weekly, at: body.at } };
}
