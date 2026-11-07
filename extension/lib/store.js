export const SETTINGS_DEFAULTS = {
  intervalMin: 60,
  areas: [],
  activeStart: "09:00",
  activeEnd: "17:00",
  workdays: [1, 2, 3, 4, 5],
  autoPause: true,
  privacy: true,
  mode: "personal",
  name: "",
  company: "",
  serverUrl: "ws://127.0.0.1:8765/ws",
  setupDone: false,
};

const PROFILE_KEY = "profile";
const SCHEDULE_KEY = "schedule";
const LOG_KEY = "breakLog";
const LOG_MAX = 500;
const CATALOG_KEY = "exerciseCatalog";

const local = chrome.storage.local;

export async function getSettings() {
  return { ...SETTINGS_DEFAULTS, ...(await local.get(Object.keys(SETTINGS_DEFAULTS))) };
}

export function saveSettings(patch) {
  return local.set(patch);
}

export async function getProfile() {
  const { [PROFILE_KEY]: stored } = await local.get(PROFILE_KEY);
  if (stored?.playerId) return stored;
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

export async function getSchedule() {
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

export async function appendLog(entry) {
  const log = await readLog();
  log.push(entry);
  await local.set({ [LOG_KEY]: log.slice(-LOG_MAX) });
}

export async function getCatalog() {
  const { [CATALOG_KEY]: catalog } = await local.get(CATALOG_KEY);
  return Array.isArray(catalog?.exercises) ? catalog.exercises : [];
}

export function cacheCatalog(msg) {
  if (!Array.isArray(msg.exercises) || !msg.exercises.length) return Promise.resolve();
  return local.set({ [CATALOG_KEY]: { exercises: msg.exercises, connections: msg.connections } });
}
