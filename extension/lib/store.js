import { currentAreas } from "./routine.js";
import { OUTBOX_KEY, DIRTY_KEY, breakEvent, addToOutbox, changedSharedKeys, markDirty } from "./sync-core.js";

export const SETTINGS_DEFAULTS = {
  intervalMin: 60,
  areas: [],
  activeStart: "09:00",
  activeEnd: "17:00",
  workdays: [1, 2, 3, 4, 5],
  autoPause: true,
  privacy: true,
  privacyStyle: "blur",
  voice: true,
  memes: true,
  mode: "personal",
  name: "",
  setupDone: false,
  theme: "auto",
  avatar: "bunny",
  lang: "auto",
  weekStart: 1,
};

const PROFILE_KEY = "profile";
const SCHEDULE_KEY = "schedule";
const LOG_KEY = "breakLog";
export const LOG_MAX = 500;
/**
 * Keys an older version stored that nothing reads any more: the pose server's URL (the model runs in
 * the extension now) and the catalog it sent (lib/pose has it).
 */
const RETIRED_KEYS = ["serverUrl", "exerciseCatalog"];
const MEME_TURNS_KEY = "memeTurns";

const local = chrome.storage.local;

/**
 * @typedef {object} Profile
 * @property {string} playerId
 * @property {string} secret
 * @property {number} xp
 * @property {number} streak
 * @property {string | null} lastStreakDay  dayKey() of the last day that counted for the streak
 * @property {string | null} lastBreakDay   dayKey() of the last finished break
 * @property {number} weekXp
 * @property {string | null} week           isoWeek() that weekXp belongs to
 * @property {string[]} badges
 * @property {object | null} daily
 * @property {object | null} weekly
 */

/** @typedef {ReturnType<typeof import("./schedule.js").initialSchedule>} Schedule */

export async function getSettings() {
  const settings = { ...SETTINGS_DEFAULTS, ...(await local.get(Object.keys(SETTINGS_DEFAULTS))) };
  return { ...settings, areas: currentAreas(settings.areas) };
}

/**
 * Saves settings. Shared settings whose value changed are marked with the time of the change,
 * so the next sync sends them (lib/sync.js); settings pulled from the server skip this.
 */
export async function saveSettings(patch, now = Date.now()) {
  const keys = changedSharedKeys(await getSettings(), patch);
  if (!keys.length) return local.set(patch);
  const { [DIRTY_KEY]: dirty } = await local.get(DIRTY_KEY);
  return local.set({ ...patch, [DIRTY_KEY]: markDirty(dirty ?? {}, keys, now) });
}

/** @returns {Promise<Profile>} */
export async function getProfile() {
  /** @type {{ [PROFILE_KEY]?: Profile }} */
  const { [PROFILE_KEY]: stored } = await local.get(PROFILE_KEY);
  if (stored?.playerId) return stored;
  /** @type {Profile} */
  const profile = {
    playerId: crypto.randomUUID(),
    secret: crypto.randomUUID(),
    xp: 0,
    streak: 0,
    lastStreakDay: null,
    lastBreakDay: null,
    weekXp: 0,
    week: null,
    badges: [],
    daily: null,
    weekly: null,
  };
  await local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export function setProfile(profile) {
  return local.set({ [PROFILE_KEY]: profile });
}

/** @returns {Promise<Schedule>} */
export async function getSchedule() {
  /** @type {{ [SCHEDULE_KEY]?: Schedule }} */
  const { [SCHEDULE_KEY]: s } = await local.get(SCHEDULE_KEY);
  return { windowId: null, lastKey: null, breakCount: 0, ...s };
}

export function setSchedule(schedule) {
  return local.set({ [SCHEDULE_KEY]: schedule });
}

export async function readLog() {
  const { [LOG_KEY]: log } = await local.get(LOG_KEY);
  return Array.isArray(log) ? log : [];
}

export async function readOutbox() {
  const { [OUTBOX_KEY]: outbox } = await local.get(OUTBOX_KEY);
  return Array.isArray(outbox) ? outbox : [];
}

/**
 * Logs a finished break and queues it for sync as an event with a fresh id; `areas` are the pain
 * areas the break worked on.
 */
export async function appendLog(entry, { areas = [] } = {}) {
  const id = crypto.randomUUID();
  const [log, outbox] = await Promise.all([readLog(), readOutbox()]);
  log.push({ ...entry, id });
  await local.set({
    [LOG_KEY]: log.slice(-LOG_MAX),
    [OUTBOX_KEY]: addToOutbox(outbox, [breakEvent(entry, { id, areas })]),
  });
}

export function setLog(log) {
  return local.set({ [LOG_KEY]: log.slice(-LOG_MAX) });
}

/** Deletes what RETIRED_KEYS lists; the service worker runs it on install, update and start-up. */
export function dropRetiredKeys() {
  return local.remove(RETIRED_KEYS);
}

export async function getActivity() {
  const { activity } = await local.get("activity");
  return activity && typeof activity === "object" ? activity : null;
}

export function setActivity(activity) {
  return local.set({ activity });
}

// Where each meme sound group left off ({ group: next clip index }), so breaks take turns.
export async function getMemeTurns() {
  const { [MEME_TURNS_KEY]: turns } = await local.get(MEME_TURNS_KEY);
  return turns && typeof turns === "object" ? turns : {};
}

export function setMemeTurns(turns) {
  return local.set({ [MEME_TURNS_KEY]: turns });
}
