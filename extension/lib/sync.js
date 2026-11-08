/**
 * Cross-device sync client (docs/plans/cross-platform-sync.md, item 2). Breaks wait in an outbox
 * (`syncOutbox`, filled by appendLog) until POST /sync/breaks takes them; other devices' breaks
 * come back from GET /sync/breaks after the stored cursor. Shared settings merge per field with
 * PATCH /me/settings, badges and challenges go up with PUT /me/progress, and XP, level, streak and
 * week XP are taken from GET /me/profile, which the server derives from every device's breaks.
 */
import { API_URL } from "../config.js";
import { getSession } from "./session.js";
import { dayKey, isoWeek } from "./xp.js";
import { getSettings, getProfile, setProfile, readLog, setLog, readOutbox, getActivity, setActivity, LOG_MAX } from "./store.js";
import { recordActivity, backfillActivity } from "./activity.js";
import { scheduleSettingsChanged } from "./schedule.js";
import {
  OUTBOX_KEY, DIRTY_KEY, STATE_KEY, PUSH_BATCH, PULL_LIMIT, MIN_AT,
  backfillEvents, addToOutbox, removeFromOutbox, dirtyPatches, clearDirty, seedPatch, remotePatch,
  progressOf, mergeProfile, mergeLog, lastBreakAt,
} from "./sync-core.js";

const REJECTED_KEY = "syncRejected";
const MAX_PAGES = 20;
const OUTBOX_MAX_BATCHES = 50;
const TIMEOUT_MS = 15_000;

/**
 * Where the API lives, how to get a session, the clock, and `lock`, which runs a storage
 * read-modify-write so it can't interleave with the service worker's other writes (it passes its
 * serial queue). Network calls run outside the lock. Tests pass their own.
 * @typedef {{ url: string, session: () => Promise<any>, now?: () => number, lock?: (fn: () => Promise<any>) => Promise<any> }} SyncConfig
 */
/** @type {SyncConfig} */
const DEFAULT_CFG = { url: API_URL, session: getSession };

class HttpError extends Error {
  constructor(status, path) {
    super(`sync ${status} ${path}`);
    this.status = status;
  }
}

const refused = (err) => err instanceof HttpError && err.status === 400;

const local = () => chrome.storage.local;
const getKey = async (key, fallback) => (await local().get(key))[key] ?? fallback;

/**
 * @typedef {{ user: string | null, cursor: number, backfilled: boolean, seeded: boolean, progressJson: string | null }} SyncState
 */
/** @returns {Promise<SyncState>} */
export async function readState() {
  return { user: null, cursor: 0, backfilled: false, seeded: false, progressJson: null, ...(await getKey(STATE_KEY, {})) };
}

const writeState = async (patch) => local().set({ [STATE_KEY]: { ...(await readState()), ...patch } });

function api(cfg, session) {
  return async (method, path, body) => {
    const res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(res.status, path);
    return res.status === 204 ? null : res.json();
  };
}

const localKeys = (now) => `day=${dayKey(now)}&week=${isoWeek(now)}`;

/**
 * Sync state belongs to one account: signing in as someone else starts over (cursor 0, backfill
 * and settings seed again). The first sync for an account queues the whole local log, with
 * UUIDv5 ids for entries logged before sync, so repeating it never counts a break twice.
 */
async function prepare(userId, now) {
  const state = await readState();
  if (state.user !== userId) {
    await local().set({ [STATE_KEY]: { user: userId, cursor: 0, backfilled: false, seeded: false, progressJson: null } });
  }
  if ((await readState()).backfilled) return;
  const [profile, log, outbox] = await Promise.all([getProfile(), readLog(), readOutbox()]);
  const { events, log: withIds } = await backfillEvents(log, profile.playerId, now);
  await setLog(withIds);
  await local().set({ [OUTBOX_KEY]: addToOutbox(outbox, events) });
  await writeState({ backfilled: true });
}

/**
 * Uploads the outbox in batches of PUSH_BATCH. A batch the server refuses (400) is set aside in
 * `syncRejected` so one bad event can't block the queue. Resolves the events still waiting.
 */
export async function pushOutbox(cfg, call) {
  const lock = cfg.lock ?? ((fn) => fn());
  const now = cfg.now ?? Date.now;
  for (let i = 0; i < OUTBOX_MAX_BATCHES; i++) {
    const batch = (await readOutbox()).slice(0, PUSH_BATCH);
    if (!batch.length) break;
    const ids = batch.map((e) => e.id);
    try {
      await call("POST", `/sync/breaks?${localKeys(now())}`, { events: batch });
    } catch (err) {
      if (!refused(err)) throw err;
      await lock(async () => local().set({ [REJECTED_KEY]: [...(await getKey(REJECTED_KEY, [])), ...batch].slice(-PUSH_BATCH) }));
    }
    await lock(async () => local().set({ [OUTBOX_KEY]: removeFromOutbox(await readOutbox(), ids) }));
  }
  return (await readOutbox()).length;
}

/**
 * Pulls other devices' breaks after the stored cursor into the local log and activity heatmap.
 * Resolves the latest break time the log had before, for the shared timer rule.
 */
export async function pull(cfg, call) {
  const lock = cfg.lock ?? ((fn) => fn());
  const before = lastBreakAt(await readLog());
  for (let page = 0; page < MAX_PAGES; page++) {
    const { cursor } = await readState();
    const { events, next } = await call("GET", `/sync/breaks?since=${cursor}&limit=${PULL_LIMIT}`);
    await lock(async () => {
      const log = await readLog();
      const { log: merged, added } = mergeLog(log, events, LOG_MAX);
      if (added.length) {
        let activity = (await getActivity()) ?? backfillActivity(log);
        for (const e of added) activity = recordActivity(activity, e.at, e.xp);
        await setLog(merged);
        await setActivity(activity);
      }
      await writeState({ cursor: next });
    });
    if (events.length < PULL_LIMIT) break;
  }
  return before;
}

/**
 * Sends this device's changed shared settings, fills in the ones the server has never seen (first
 * sync), then writes the server's merged document locally. Resolves whether the break schedule's
 * settings changed, so the caller can reschedule.
 */
export async function syncSettings(cfg, call) {
  const lock = cfg.lock ?? ((fn) => fn());
  const dirty = await getKey(DIRTY_KEY, {});
  const settings = await getSettings();
  const { patches, invalid } = dirtyPatches(settings, dirty);
  const sent = Object.fromEntries(invalid.map((k) => [k, dirty[k]]));
  for (const p of patches) {
    // A patch the server refuses is dropped like a sent one, so it can't block every later sync.
    await call("PATCH", "/me/settings", p).catch((err) => {
      if (!refused(err)) throw err;
    });
    for (const k of Object.keys(p.patch)) sent[k] = p.at;
  }
  if (Object.keys(sent).length) await lock(async () => local().set({ [DIRTY_KEY]: clearDirty(await getKey(DIRTY_KEY, {}), sent) }));

  let { doc } = await call("GET", "/me/settings");
  if (!(await readState()).seeded && settings.setupDone) {
    const seed = seedPatch(settings, doc);
    if (Object.keys(seed).length) {
      const res = await call("PATCH", "/me/settings", { patch: seed, at: MIN_AT }).catch((err) => {
        if (!refused(err)) throw err;
        return { doc };
      });
      doc = res.doc;
    }
    await writeState({ seeded: true });
  }
  return lock(async () => {
    const cur = await getSettings();
    const patch = remotePatch(cur, doc, await getKey(DIRTY_KEY, {}));
    if (!Object.keys(patch).length) return false;
    await local().set(patch); // not saveSettings: these are the server's values, not changes made here
    return cur.setupDone && scheduleSettingsChanged(cur, { ...cur, ...patch });
  });
}

/** PUT /me/progress when badges or challenges changed here since the last sync. */
async function pushProgress(cfg, call) {
  const now = cfg.now ?? Date.now;
  const json = JSON.stringify(progressOf(await getProfile()));
  if (json === (await readState()).progressJson) return;
  await call("PUT", "/me/progress", { ...JSON.parse(json), at: now() });
}

/**
 * One full sync: backfill (first time), push, settings, pull, progress, profile. Resolves
 * `{ ok: false, reason }` when signed out or offline, otherwise what the caller must act on:
 * `scheduleChanged` (shared schedule settings came in) and `lastBreakAt` (set when another
 * device's break is newer than the last one here, so the next break counts from it).
 * @param {SyncConfig} [cfg]
 */
export async function syncNow(cfg = DEFAULT_CFG) {
  if (!cfg.url) return { ok: false, reason: "off" };
  const now = cfg.now ?? Date.now;
  const lock = cfg.lock ?? ((fn) => fn());
  try {
    const session = await cfg.session();
    if (!session?.accessToken || !session.user?.id) return { ok: false, reason: "signed-out" };
    const call = api(cfg, session);
    await lock(() => prepare(session.user.id, now()));
    const pending = await pushOutbox(cfg, call);
    const scheduleChanged = await syncSettings(cfg, call);
    const before = await pull(cfg, call);
    await pushProgress(cfg, call);
    const profile = await call("GET", `/me/profile?${localKeys(now())}`);
    // While breaks are still queued (one may have finished during this sync) the server's totals
    // miss them, so keep the local profile until they are up.
    if (pending === 0) {
      await lock(async () => {
        if ((await readOutbox()).length) return;
        const merged = mergeProfile(await getProfile(), profile);
        await setProfile(merged);
        // What the server holds now: when the merge added badges it lacks, the next sync sends them.
        await writeState({ progressJson: JSON.stringify(progressOf(profile)) });
      });
    }
    const moved = typeof profile.lastBreakAt === "number" && profile.lastBreakAt > before;
    return { ok: true, pending, scheduleChanged, lastBreakAt: moved ? profile.lastBreakAt : null, profile };
  } catch (err) {
    return { ok: false, reason: err instanceof HttpError ? `http ${err.status}` : "offline", error: String(err) };
  }
}
