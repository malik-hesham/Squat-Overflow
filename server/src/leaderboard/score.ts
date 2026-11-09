/** What a player submits after a break. The extension computes it; the server only range-checks it. */
export interface Score {
  name: string;
  xp: number;
  level: number;
  streak: number;
  weekXp: number;
  week: string; // ISO week, e.g. "2026-W45"
  avatar: string;
}

export type ScoreCheck = { ok: true; score: Score } | { ok: false; error: string };

const MAX_XP = 1_000_000;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const AVATAR_RE = /^[a-z]{2,20}$/;

/** ISO 8601 week of `now` in UTC, as "YYYY-Www" (the year is the ISO week-numbering year). */
export function isoWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Same rules the Supabase `submit_score` function enforced, with the same error texts. */
export function validateScore(body: unknown): ScoreCheck {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 40) return { ok: false, error: 'invalid name' };
  if (!intIn(b.xp, 0, MAX_XP) || !intIn(b.weekXp, 0, MAX_XP)) return { ok: false, error: 'invalid xp' };
  if (!intIn(b.level, 1, 8)) return { ok: false, error: 'invalid level' };
  if (!intIn(b.streak, 0, 10_000)) return { ok: false, error: 'invalid streak' };
  if (typeof b.week !== 'string' || !WEEK_RE.test(b.week)) return { ok: false, error: 'invalid week' };
  const avatar = b.avatar === undefined ? 'bunny' : b.avatar;
  if (typeof avatar !== 'string' || !AVATAR_RE.test(avatar)) return { ok: false, error: 'invalid avatar' };
  return { ok: true, score: { name, xp: b.xp, level: b.level, streak: b.streak, weekXp: b.weekXp, week: b.week, avatar } };
}
