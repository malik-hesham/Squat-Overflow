/**
 * The pure half of cross-device sync (docs/plans/cross-platform-sync.md): turning log entries
 * into break events, backfill ids, and the outbox, settings and profile merges. No chrome.* and
 * no fetch, so store.js, sync.js, the tests and the mobile app can all import it.
 */
import { dayKey, isoWeek } from "./xp.js";

export const OUTBOX_KEY = "syncOutbox";
export const DIRTY_KEY = "syncDirty";
export const STATE_KEY = "syncState";
export const OUTBOX_MAX = 2000;
export const PUSH_BATCH = 200;
export const PULL_LIMIT = 500;
export const DEVICE = "chrome";
/** The server refuses breaks before this and more than MAX_FUTURE_MS ahead (server/src/sync/validate.ts). */
export const MIN_AT = Date.UTC(2024, 0, 1);
const MAX_FUTURE_MS = 24 * 3_600_000;
/** Namespace for backfill ids: UUIDv5(`${playerId}:${at}`), so re-uploading old logs never counts twice. */
export const BACKFILL_NAMESPACE = "240ab37e-ad3a-409a-a2f2-29f50c8e346d";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AVATAR_RE = /^[a-z]{2,20}$/;
const LANG_RE = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
const BADGE_RE = /^(?! )[A-Za-z0-9_.:& -]{1,60}(?<! )$/; // server/src/sync/validate.ts
const MAX_CHALLENGE_JSON = 4_096;

const intIn = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const strIn = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;
const areaList = (v) => Array.isArray(v) && v.length <= 20 && v.every((a) => strIn(a, 1, 40));

/** Settings every device shares, with the server's check for each (SHARED_SETTINGS in validate.ts). */
export const SHARED_SETTINGS = {
  intervalMin: (v) => intIn(v, 1, 240),
  areas: areaList,
  activeStart: (v) => typeof v === "string" && TIME_RE.test(v),
  activeEnd: (v) => typeof v === "string" && TIME_RE.test(v),
  workdays: (v) => Array.isArray(v) && v.length <= 7 && new Set(v).size === v.length && v.every((d) => intIn(d, 0, 6)),
  autoPause: (v) => typeof v === "boolean",
  voice: (v) => typeof v === "boolean",
  memes: (v) => typeof v === "boolean",
  mode: (v) => v === "personal" || v === "competitive",
  name: (v) => typeof v === "string" && v.trim().length <= 40,
  avatar: (v) => typeof v === "string" && AVATAR_RE.test(v),
  lang: (v) => typeof v === "string" && LANG_RE.test(v),
  weekStart: (v) => intIn(v, 0, 6),
};
export const SHARED_KEYS = Object.keys(SHARED_SETTINGS);

const validShared = (key, value) => Boolean(SHARED_SETTINGS[key]?.(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clampInt = (v, min, max, fallback) => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/**
 * A finished break as the server takes it: the log entry plus the device's local `day` and
 * `week`, its device and the pain areas. Null when `at` is outside what the server accepts.
 */
export function breakEvent(entry, { id, areas = [], device = DEVICE, now = Date.now() }) {
  const at = clampInt(entry?.at, 0, Number.MAX_SAFE_INTEGER, Number.NaN);
  if (!Number.isFinite(at) || at < MIN_AT || at > now + MAX_FUTURE_MS) return null;
  return {
    id,
    at,
    day: dayKey(at),
    week: isoWeek(at),
    device,
    reps: clampInt(entry.reps, 0, 10_000, 0),
    moves: clampInt(entry.moves, 0, 100, 0),
    score: entry.score == null ? null : clampInt(entry.score, 0, 100, null),
    xp: clampInt(entry.xp, 0, 1_000, 0),
    scored: Boolean(entry.scored),
    completed: Boolean(entry.completed),
    areas: Array.isArray(areas) ? areas.filter((a) => strIn(a, 1, 40)).slice(0, 20) : [],
  };
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** RFC 4122 name-based UUID (version 5, SHA-1). */
export async function uuidv5(name, namespace) {
  const ns = namespace.replace(/-/g, "").match(/../g).map((h) => parseInt(h, 16));
  const bytes = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const b = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The id of a break logged before sync existed: the same on every upload of the same log. */
export const backfillId = (playerId, at) => uuidv5(`${playerId}:${at}`, BACKFILL_NAMESPACE);

/**
 * The events to upload for a log on the first sync after sign-in, and the log with every entry
 * holding its event id (so pulled copies of these breaks are recognised). Entries pulled from
 * other devices are left out; entries without an id get the backfill id of `playerId:at`.
 */
export async function backfillEvents(log, playerId, now = Date.now()) {
  const events = [];
  const out = [];
  for (const entry of log) {
    const id = entry.id ?? (await backfillId(playerId, entry.at));
    out.push(entry.id ? entry : { ...entry, id });
    if (entry.device) continue; // pulled from the server: only this device's own breaks have no device
    const ev = breakEvent(entry, { id, areas: entry.areas ?? [], now });
    if (ev) events.push(ev);
  }
  return { events, log: out };
}

/** Adds events to the outbox (an id already queued is kept once), oldest dropped past OUTBOX_MAX. */
export function addToOutbox(outbox, events) {
  const ids = new Set(outbox.map((e) => e.id));
  const fresh = events.filter((e) => e && !ids.has(e.id) && ids.add(e.id));
  return [...outbox, ...fresh].slice(-OUTBOX_MAX);
}

export function removeFromOutbox(outbox, ids) {
  const sent = new Set(ids);
  return outbox.filter((e) => !sent.has(e.id));
}

/** Shared settings whose value differs between `prev` and `next` (keys missing from `next` don't count). */
export function changedSharedKeys(prev, next) {
  return SHARED_KEYS.filter((k) => k in next && !same(prev[k], next[k]));
}

/** Records that `keys` changed on this device at `at`, for the next PATCH /me/settings. */
export function markDirty(dirty, keys, at) {
  return keys.length ? { ...dirty, ...Object.fromEntries(keys.map((k) => [k, at])) } : dirty;
}

/**
 * The PATCH bodies for this device's unsent setting changes, one per change time so each field
 * carries its own timestamp, oldest first. `invalid` are dirty keys the server would refuse.
 */
export function dirtyPatches(settings, dirty) {
  const byAt = new Map();
  const invalid = [];
  for (const [key, at] of Object.entries(dirty ?? {})) {
    if (!validShared(key, settings[key]) || !intIn(at, MIN_AT, Number.MAX_SAFE_INTEGER)) {
      invalid.push(key);
      continue;
    }
    byAt.set(at, { ...byAt.get(at), [key]: settings[key] });
  }
  const patches = [...byAt.entries()].sort((a, b) => a[0] - b[0]).map(([at, patch]) => ({ patch, at }));
  return { patches, invalid };
}

/** Drops the dirty marks that were sent, unless the field changed again since (a newer `at`). */
export function clearDirty(dirty, sent) {
  return Object.fromEntries(Object.entries(dirty ?? {}).filter(([k, at]) => !(k in sent) || at > sent[k]));
}

/**
 * Shared settings the server has never seen, from this device's current values. Sent with the
 * oldest allowed time, so a value another device already set always wins.
 */
export function seedPatch(settings, doc) {
  return Object.fromEntries(SHARED_KEYS.filter((k) => !(k in doc) && validShared(k, settings[k])).map((k) => [k, settings[k]]));
}

/** The server's settings to write locally: valid shared keys that differ and have no unsent local change. */
export function remotePatch(settings, doc, dirty) {
  return Object.fromEntries(
    Object.entries(doc ?? {}).filter(([k, v]) => validShared(k, v) && !(k in (dirty ?? {})) && !same(settings[k], v)),
  );
}

/** Badges and challenge state as PUT /me/progress takes them; badge ids the server refuses are left out. */
export function progressOf(profile) {
  const small = (v) => (v && typeof v === "object" && !Array.isArray(v) && JSON.stringify(v).length <= MAX_CHALLENGE_JSON ? v : null);
  return {
    badges: (profile.badges ?? []).filter((b) => typeof b === "string" && BADGE_RE.test(b)).slice(0, 200),
    daily: small(profile.daily),
    weekly: small(profile.weekly),
  };
}

/**
 * The local profile after a sync: XP, streak and week XP come from the server (derived from every
 * device's breaks), badges are the union, challenges are the server's last-write-wins copy.
 * `lastStreakDay` follows the server's last break when it has a streak, so a break here later
 * that day doesn't start a second "first break of the day".
 */
export function mergeProfile(local, server) {
  const p = { ...local, xp: server.xp, streak: server.streak, week: server.week, weekXp: server.weekXp };
  const last = server.lastBreakDay;
  if (last && (!local.lastBreakDay || last > local.lastBreakDay)) p.lastBreakDay = last;
  if (last && server.streak > 0 && (!local.lastStreakDay || last > local.lastStreakDay)) p.lastStreakDay = last;
  p.badges = [...new Set([...(local.badges ?? []), ...(server.badges ?? [])])];
  if (server.daily) p.daily = server.daily;
  if (server.weekly) p.weekly = server.weekly;
  return p;
}

/** The latest break time in a log, or 0. */
export const lastBreakAt = (log) => log.reduce((m, e) => Math.max(m, Number(e.at) || 0), 0);

/**
 * Pulled events merged into the local log: ones whose id is already there are skipped, the rest
 * become log entries (with their device), sorted by time and capped at `max`.
 */
export function mergeLog(log, events, max) {
  const ids = new Set(log.map((e) => e.id).filter(Boolean));
  const added = [];
  for (const e of events) {
    if (ids.has(e.id)) continue;
    ids.add(e.id);
    const { id, at, reps, moves, score, xp, scored, completed, device, areas } = e;
    added.push({ at, reps, moves, score, xp, scored, completed, id, device, areas });
  }
  if (!added.length) return { log, added };
  return { log: [...log, ...added].sort((a, b) => a.at - b.at).slice(-max), added };
}
