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
  company: '',
  setupDone: false,
  theme: 'auto',
  avatar: 'bunny',
  lang: 'auto',
  weekStart: 1,
};

export type Settings = typeof SETTINGS_DEFAULTS;

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

export function saveSettings(patch: Partial<Settings>): Promise<void> {
  return setItems(patch);
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

export function setProfile(profile: Profile): Promise<void> {
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
