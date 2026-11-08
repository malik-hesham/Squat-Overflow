// The app's saved state, with the same shapes as extension/lib/store.js so the
// shared XP, challenge and leaderboard code works on it unchanged.
import { randomUUID } from 'expo-crypto';

import { emptySchedule, type Schedule } from './plan';
import { currentAreas } from './shared';
import { getItem, getItems, setItems } from './storage';

export const SETTINGS_DEFAULTS = {
  intervalMin: 60,
  areas: [] as string[],
  activeStart: '09:00',
  activeEnd: '17:00',
  workdays: [1, 2, 3, 4, 5],
  autoPause: true, // don't interrupt calendar meetings
  calendar: false, // read busy times from the phone's calendars
  privacy: true, // blur the camera preview
  voice: true,
  memes: true,
  mode: 'personal' as 'personal' | 'competitive',
  name: '',
  setupDone: false,
  theme: 'auto',
  avatar: 'bunny',
  lang: 'auto',
  weekStart: 1,
};

export type Settings = typeof SETTINGS_DEFAULTS;

// Settings every signed-in device shares (SHARED_SETTINGS in server/src/sync/validate.ts). The
// rest (calendar, privacy, setupDone, theme) stay on this phone.
export const SHARED_SETTINGS = [
  'intervalMin',
  'areas',
  'activeStart',
  'activeEnd',
  'workdays',
  'autoPause',
  'voice',
  'memes',
  'mode',
  'name',
  'avatar',
  'lang',
  'weekStart',
] as const satisfies readonly (keyof Settings)[];
export type SharedSetting = (typeof SHARED_SETTINGS)[number];
const isShared = (k: string): k is SharedSetting => (SHARED_SETTINGS as readonly string[]).includes(k);

// Sync bookkeeping written here so every local change is seen: when each shared setting last
// changed on this phone and hasn't been sent yet ({ key: epoch ms }), and when the profile's
// badges or challenges last changed.
export const SETTINGS_DIRTY_KEY = 'syncSettingsDirty';
export const PROGRESS_AT_KEY = 'syncProgressAt';

export type Profile = {
  playerId: string;
  secret: string;
  xp: number;
  streak: number;
  lastStreakDay: string | null;
  lastBreakDay: string | null;
  weekXp: number;
  week: string | null;
  badges: string[];
  daily: {
    day: string;
    ids: string[];
    areas: string[];
    breaks: number;
    run: number;
    done: string[];
  } | null;
  weekly: { week: string; area: string; count: number; done: boolean } | null;
};

export type LogEntry = {
  id?: string; // the break event's id on the server; set when queued or backfilled for sync
  device?: string; // set on breaks pulled from another device
  at: number;
  reps: number;
  moves: number;
  score: number | null;
  xp: number;
  scored: boolean;
  completed: boolean;
};

export type Activity = Record<string, { breaks: number; xp: number }>;

const PROFILE_KEY = 'profile';
const SCHEDULE_KEY = 'schedule';
const LOG_KEY = 'breakLog';
const LOG_MAX = 500;
const ACTIVITY_KEY = 'activity';
const MEME_TURNS_KEY = 'memeTurns';
const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof Settings)[];

export async function getSettings(): Promise<Settings> {
  const settings = { ...SETTINGS_DEFAULTS, ...(await getItems<Settings>(SETTINGS_KEYS)) };
  return { ...settings, areas: currentAreas(settings.areas) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Saves a change the user made; shared settings that really changed are queued for sync. */
export async function saveSettings(patch: Partial<Settings>, now = Date.now()): Promise<void> {
  const before = await getSettings();
  const changed = Object.keys(patch).filter((k) => isShared(k) && !same(before[k as SharedSetting], patch[k as SharedSetting]));
  if (!changed.length) return setItems(patch);
  const dirty = (await getItem<Record<string, number>>(SETTINGS_DIRTY_KEY)) ?? {};
  for (const k of changed) dirty[k] = now;
  return setItems({ ...patch, [SETTINGS_DIRTY_KEY]: dirty });
}

export async function getProfile(): Promise<Profile> {
  const stored = await getItem<Profile>(PROFILE_KEY);
  if (stored?.playerId) return stored;
  const profile: Profile = {
    playerId: randomUUID(),
    secret: randomUUID(),
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
  await setItems({ [PROFILE_KEY]: profile });
  return profile;
}

const progressOf = (p: Profile | undefined) => JSON.stringify([p?.badges ?? [], p?.daily ?? null, p?.weekly ?? null]);

/**
 * Saves the profile. A local change to badges or challenges is stamped for sync; `fromServer`
 * marks a write that copies the server's profile, which has nothing to send back.
 */
export async function setProfile(profile: Profile, { fromServer = false, now = Date.now() } = {}): Promise<void> {
  if (!fromServer && progressOf(await getItem<Profile>(PROFILE_KEY)) !== progressOf(profile)) {
    return setItems({ [PROFILE_KEY]: profile, [PROGRESS_AT_KEY]: now });
  }
  return setItems({ [PROFILE_KEY]: profile });
}

export async function getSchedule(): Promise<Schedule> {
  return { ...emptySchedule(), ...(await getItem<Partial<Schedule>>(SCHEDULE_KEY)) };
}

export function setSchedule(schedule: Schedule): Promise<void> {
  return setItems({ [SCHEDULE_KEY]: schedule });
}

export async function readLog(): Promise<LogEntry[]> {
  const log = await getItem<LogEntry[]>(LOG_KEY);
  return Array.isArray(log) ? log : [];
}

export async function appendLog(entry: LogEntry): Promise<void> {
  const log = await readLog();
  log.push(entry);
  await setItems({ [LOG_KEY]: log.slice(-LOG_MAX) });
}

/** Replaces the whole log (sync merges other devices' breaks in), keeping the newest LOG_MAX. */
export function writeLog(log: LogEntry[]): Promise<void> {
  return setItems({ [LOG_KEY]: log.slice(-LOG_MAX) });
}

export async function getActivity(): Promise<Activity | null> {
  const activity = await getItem<Activity>(ACTIVITY_KEY);
  return activity && typeof activity === 'object' ? activity : null;
}

export function setActivity(activity: Activity): Promise<void> {
  return setItems({ [ACTIVITY_KEY]: activity });
}

// Where each meme sound group left off ({ group: next clip index }), so breaks take turns.
export async function getMemeTurns(): Promise<Record<string, number>> {
  const turns = await getItem<Record<string, number>>(MEME_TURNS_KEY);
  return turns && typeof turns === 'object' ? turns : {};
}

export function setMemeTurns(turns: Record<string, number>): Promise<void> {
  return setItems({ [MEME_TURNS_KEY]: turns });
}

export const STORE_KEYS = { settings: SETTINGS_KEYS as string[], PROFILE_KEY, SCHEDULE_KEY, LOG_KEY, ACTIVITY_KEY };
