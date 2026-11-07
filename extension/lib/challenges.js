import { dayKey, isoWeek } from "./xp.js";
import { AREAS, featuredArea } from "./routine.js";

export const DAILY_POOL = [
  { id: "variety", name: "Variety pack", bonus: 25 },
  { id: "high_five", name: "High five", bonus: 30 },
  { id: "clean_form", name: "Clean form", bonus: 20 },
  { id: "early_mover", name: "Early mover", bonus: 15 },
  { id: "no_excuses", name: "No excuses", bonus: 25 },
];

export const WEEKLY = { target: 10, bonus: 100 };

const DAILY_MIN = 2;
const DAILY_MAX = 5;
const EARLY_HOUR = 10;

function hash(text) {
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function dailyFor(now) {
  const day = dayKey(now);
  const offset = hash(day) % DAILY_POOL.length;
  const count = DAILY_MIN + (hash(`${day}:count`) % (DAILY_MAX - DAILY_MIN + 1));
  return Array.from({ length: count }, (_, k) => DAILY_POOL[(offset + k) % DAILY_POOL.length].id);
}

export function withPeriods(profile, now) {
  const p = structuredClone(profile);
  const day = dayKey(now);
  const week = isoWeek(now);
  if (p.daily?.day !== day) p.daily = { day, ids: dailyFor(now), areas: [], breaks: 0, run: 0, done: [] };
  if (p.weekly?.week !== week) p.weekly = { week, area: featuredArea(now), count: 0, done: false };
  else if (!AREAS.includes(p.weekly.area)) p.weekly.area = featuredArea(now); // area renamed by an update
  return p;
}

export function updateChallenges(profile, result, avgForm, now) {
  const p = withPeriods(profile, now);
  const d = p.daily;
  const w = p.weekly;
  const completedMoves = result.moves.filter((m) => m.completed);
  d.areas = [...new Set([...d.areas, ...completedMoves.map((m) => m.area)])];
  d.breaks += 1;
  d.run += 1;
  const meets = {
    variety: d.areas.length >= 3,
    high_five: d.breaks >= 5,
    clean_form: avgForm >= 90,
    early_mover: new Date(now).getHours() < EARLY_HOUR,
    no_excuses: d.run >= 3,
  };
  const completed = [];
  const newBadges = [];
  const badge = (id) => {
    if (p.badges.includes(id)) return;
    p.badges.push(id);
    newBadges.push(id);
  };
  for (const id of d.ids) {
    if (d.done.includes(id) || !meets[id]) continue;
    d.done.push(id);
    const c = DAILY_POOL.find((x) => x.id === id);
    completed.push({ id, name: c.name, bonus: c.bonus });
    badge(`daily:${id}`);
  }
  w.count = Math.min(WEEKLY.target, w.count + completedMoves.filter((m) => m.area === w.area).length);
  if (!w.done && w.count >= WEEKLY.target) {
    w.done = true;
    completed.push({ id: "weekly", name: `${w.area} week`, bonus: WEEKLY.bonus });
    badge(`weekly:${w.area}`);
  }
  return { profile: p, completed, newBadges };
}

export function noteAction(profile, action, now) {
  const p = withPeriods(profile, now);
  if (["snooze", "skip", "close"].includes(action)) p.daily.run = 0;
  return p;
}
