/**
 * The profile every device shows, derived from the user's break events. LEVELS and the streak
 * rule mirror extension/lib/xp.js (the server is CommonJS and ships alone in its Docker image,
 * so it can't import that ES module); test/sync/profile.spec.ts pins them to the same values.
 */

export const LEVELS = [
  { level: 1, name: 'Desk Potato', xp: 0 },
  { level: 2, name: 'Chair Escapee', xp: 100 },
  { level: 3, name: 'Stretch Rookie', xp: 250 },
  { level: 4, name: 'Desk Mover', xp: 500 },
  { level: 5, name: 'Posture Pro', xp: 900 },
  { level: 6, name: 'Flow Stretcher', xp: 1400 },
  { level: 7, name: 'Mobility Ninja', xp: 2000 },
  { level: 8, name: 'Movement Master', xp: 3000 },
] as const;

export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

export function levelFor(xp: number): { level: number; name: string } {
  let i = LEVELS.length - 1;
  while (i > 0 && xp < LEVELS[i].xp) i--;
  return { level: LEVELS[i].level, name: LEVELS[i].name };
}

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

/** The workday before `day` (a "YYYY-MM-DD" key), or null when no weekday is a workday. */
export function previousWorkday(day: string, workdays: readonly number[]): string | null {
  let ms = dayMs(day);
  for (let i = 0; i < 7; i++) {
    ms -= DAY_MS;
    if (workdays.includes(new Date(ms).getUTCDay())) return keyOf(ms);
  }
  return null;
}

/**
 * The streak ending on the latest day in `days` (days that had a break worth XP). Like
 * award() in xp.js: a day extends the run when the previous counted day is on or after the
 * workday before it, so weekends and other days off don't break it.
 */
export function streakFrom(days: readonly string[], workdays: readonly number[]): number {
  const sorted = [...new Set(days)].sort().reverse();
  if (sorted.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = previousWorkday(sorted[i - 1], workdays);
    if (prev === null || sorted[i] < prev) break;
    streak++;
  }
  return streak;
}

export interface Profile {
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
}

export interface ProfileInputs {
  totalXp: number;
  weekXp: number;
  todayBreaks: number;
  breaks: number;
  lastBreakAt: number | null;
  lastBreakDay: string | null;
  xpDays: string[];
  workdays: readonly number[];
  progress: { badges?: string[]; daily?: unknown; weekly?: unknown };
}

export function buildProfile(day: string, week: string, i: ProfileInputs): Profile {
  const lvl = levelFor(i.totalXp);
  return {
    xp: i.totalXp,
    level: lvl.level,
    levelName: lvl.name,
    streak: streakFrom(i.xpDays, i.workdays),
    week,
    weekXp: i.weekXp,
    day,
    todayBreaks: i.todayBreaks,
    breaks: i.breaks,
    lastBreakAt: i.lastBreakAt,
    lastBreakDay: i.lastBreakDay,
    badges: i.progress.badges ?? [],
    daily: i.progress.daily ?? null,
    weekly: i.progress.weekly ?? null,
  };
}
