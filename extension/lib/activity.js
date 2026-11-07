import { dayKey } from "./xp.js";

const KEEP_DAYS = 371;
const DAY_MS = 86_400_000;

export function activityLevel(breaks) {
  if (breaks <= 0) return 0;
  if (breaks <= 2) return 1;
  if (breaks <= 4) return 2;
  if (breaks <= 6) return 3;
  return 4;
}

export function recordActivity(activity, now, xp) {
  const key = dayKey(now);
  const cutoff = dayKey(now - KEEP_DAYS * DAY_MS);
  const next = Object.fromEntries(Object.entries(activity ?? {}).filter(([day]) => day >= cutoff));
  const prev = next[key] ?? { breaks: 0, xp: 0 };
  next[key] = { breaks: prev.breaks + 1, xp: prev.xp + (xp || 0) };
  return next;
}

export function backfillActivity(log) {
  const out = {};
  for (const entry of log) {
    const key = dayKey(entry.at);
    const prev = out[key] ?? { breaks: 0, xp: 0 };
    out[key] = { breaks: prev.breaks + 1, xp: prev.xp + (entry.xp || 0) };
  }
  return out;
}

function firstMonday(now, weeks) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * (weeks - 1));
  return d;
}

export function heatmapWeeks(activity, now, weeks, workdays) {
  const today = dayKey(now);
  const d = firstMonday(now, weeks);
  return Array.from({ length: weeks }, () =>
    Array.from({ length: 7 }, () => {
      const at = d.getTime();
      const day = dayKey(at);
      const entry = activity?.[day] ?? { breaks: 0, xp: 0 };
      const cell = {
        day,
        at,
        breaks: entry.breaks,
        xp: entry.xp,
        level: activityLevel(entry.breaks),
        future: day > today,
        offday: !workdays.includes(d.getDay()),
      };
      d.setDate(d.getDate() + 1);
      return cell;
    }),
  );
}

export function activityTotals(activity, now, weeks) {
  const start = dayKey(firstMonday(now, weeks).getTime());
  const today = dayKey(now);
  const days = Object.entries(activity ?? {}).filter(([day]) => day >= start && day <= today);
  return {
    breaks: days.reduce((n, [, e]) => n + e.breaks, 0),
    xp: days.reduce((n, [, e]) => n + e.xp, 0),
    activeDays: days.filter(([, e]) => e.breaks > 0).length,
  };
}
