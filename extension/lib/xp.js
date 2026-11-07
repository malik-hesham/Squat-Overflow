export const LEVELS = [
  { level: 1, name: "Desk Potato", xp: 0 },
  { level: 2, name: "Chair Escapee", xp: 100 },
  { level: 3, name: "Stretch Rookie", xp: 250 },
  { level: 4, name: "Desk Mover", xp: 500 },
  { level: 5, name: "Posture Pro", xp: 900 },
  { level: 6, name: "Flow Stretcher", xp: 1400 },
  { level: 7, name: "Mobility Ninja", xp: 2000 },
  { level: 8, name: "Movement Master", xp: 3000 },
];

export const XP = { base: 10, firstBreak: 5, streakPerDay: 1, streakMax: 10 };

const DAY_MS = 86_400_000;
const pad2 = (n) => String(n).padStart(2, "0");

export function levelFor(xp) {
  let i = LEVELS.length - 1;
  while (i > 0 && xp < LEVELS[i].xp) i--;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1];
  return {
    level: cur.level,
    name: cur.name,
    floor: cur.xp,
    next: next ? next.xp : null,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
  };
}

export function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoParts(now) {
  const local = new Date(now);
  const d = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / DAY_MS + 1) / 7) };
}

export function isoWeekNumber(now) {
  return isoParts(now).week;
}

export function isoWeek(now) {
  const { year, week } = isoParts(now);
  return `${year}-W${pad2(week)}`;
}

export function breakXp({ countedReps, targetReps, scores }) {
  if (!scores?.length || !targetReps) return 0;
  const completion = Math.min(1, countedReps / targetReps);
  const form = scores.reduce((a, b) => a + b, 0) / scores.length / 100;
  return Math.round(XP.base * completion * form);
}

function previousWorkday(now, workdays) {
  const d = new Date(now);
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() - 1);
    if (workdays.includes(d.getDay())) return dayKey(d.getTime());
  }
  return null;
}

export function award(profile, result, now, workdays) {
  const p = structuredClone(profile);
  const today = dayKey(now);
  const week = isoWeek(now);
  const before = levelFor(p.xp).level;
  if (p.week !== week) {
    p.week = week;
    p.weekXp = 0;
  }
  const breakdown = { breakXp: 0, firstBreak: 0, streak: 0, challenges: [], total: 0 };
  p.lastBreakDay = today;
  if (!result.scored) return { profile: p, breakdown, levelUp: null };

  breakdown.breakXp = breakXp(result);
  if (breakdown.breakXp > 0 && p.lastStreakDay !== today) {
    p.streak = p.lastStreakDay && p.lastStreakDay === previousWorkday(now, workdays) ? p.streak + 1 : 1;
    p.lastStreakDay = today;
    breakdown.firstBreak = XP.firstBreak;
    breakdown.streak = Math.min(p.streak * XP.streakPerDay, XP.streakMax);
  }
  breakdown.total = breakdown.breakXp + breakdown.firstBreak + breakdown.streak;
  p.xp += breakdown.total;
  p.weekXp += breakdown.total;
  const after = levelFor(p.xp);
  const levelUp = after.level > before ? { from: before, to: after.level, name: after.name } : null;
  return { profile: p, breakdown, levelUp };
}
