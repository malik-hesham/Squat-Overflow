import { LEVELS, dayKey, levelFor } from "./xp.js";

// How the sensitive-mode character looks after your recent habits: buffer as
// you level up, droopier the more workdays in a row you go without a break.
export const DROOP_DAYS = 5; // a full work week without a break: as droopy as it gets
const LOOKBACK_DAYS = 21;

const hasBreak = (activity, day) => (activity?.[day]?.breaks ?? 0) > 0;

// Workdays in a row with no break, counted back from yesterday. A break today
// resets it, and days before your first recorded break don't count, so a new
// user starts perky.
export function missedWorkdays(activity, now, workdays) {
  const active = Object.keys(activity ?? {}).filter((day) => hasBreak(activity, day));
  if (!active.length || hasBreak(activity, dayKey(now))) return 0;
  const first = active.sort()[0];
  const d = new Date(now);
  let missed = 0;
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    d.setDate(d.getDate() - 1);
    const day = dayKey(d.getTime());
    if (day < first || hasBreak(activity, day)) break;
    if (workdays.includes(d.getDay())) missed++;
  }
  return missed;
}

// `buff` and `droop` are both 0..1; they don't cancel out, so a high-level
// character that skipped a week is buff and droopy at once.
export function avatarFitness(xp, activity, now, workdays) {
  const missed = missedWorkdays(activity, now, workdays);
  return {
    buff: (levelFor(xp).level - 1) / (LEVELS.length - 1),
    droop: Math.min(missed, DROOP_DAYS) / DROOP_DAYS,
    missed,
  };
}

export function fitnessCaption({ buff, missed }, characterLabel) {
  const who = `Your ${characterLabel.toLowerCase()}`;
  if (missed >= DROOP_DAYS) return `${who} hasn't moved in a week. It's becoming one with the chair.`;
  if (missed >= 2) return `${who} is drooping. ${missed} workdays without a break.`;
  if (missed === 1) return `${who} missed you yesterday. One break and it perks right up.`;
  if (buff >= 1) return `${who} is at peak form. It does squats to warm up for squats.`;
  if (buff >= 0.5) return `${who} is getting swole. Keep it up.`;
  if (buff > 0) return `${who} is starting to tone up.`;
  return `Level up and ${who.toLowerCase()} buffs up with you.`;
}
