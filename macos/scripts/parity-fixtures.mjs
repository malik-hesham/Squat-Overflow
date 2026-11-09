#!/usr/bin/env node
// Expected outputs for the Mac app's Swift ports of the extension's rules, computed by the
// extension's own modules (extension/lib). The Swift tests in macos/SquatCore replay every case
// and must get the same answer, so a rule changed in the extension fails the Mac tests until the
// port follows. Also exports the extension's i18n strings, which the Mac app bundles as-is.
//
//   node macos/scripts/parity-fixtures.mjs           writes both files
//   node macos/scripts/parity-fixtures.mjs --check   exits 1 if either file is out of date
//
// Local-time rules (day keys, ISO weeks, active hours) run in Europe/Berlin so the cases cross
// daylight-saving changes; the Swift tests use the same zone.
process.env.TZ = "Europe/Berlin";

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lib = (name) => import(join(ROOT, "extension", "lib", name));

const xp = await lib("xp.js");
const schedule = await lib("schedule.js");
const routine = await lib("routine.js");
const challenges = await lib("challenges.js");
const activity = await lib("activity.js");
const memes = await lib("memes.js");
const syncCore = await lib("sync-core.js");
const i18n = await lib("i18n.js");
const serverStatus = await lib("server-status.js");
const badges = await lib("badges.js");
// store.js reads chrome.storage only when called; a stub lets its constants load.
globalThis.chrome = { storage: { local: {} } };
const store = await lib("store.js");
const auth = await lib("auth.js");

const OUT = join(ROOT, "macos", "SquatCore", "Tests", "SquatCoreTests", "Fixtures", "parity.json");
const STRINGS_OUT = join(ROOT, "macos", "SquatCore", "Sources", "SquatCore", "Resources", "i18n.json");

// Deterministic randomness (mulberry32), so the file only changes when a rule does.
let seed = 0x5eed;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const subset = (xs, min = 0) => {
  const out = xs.filter(() => rand() < 0.5);
  while (out.length < min) {
    const x = pick(xs);
    if (!out.includes(x)) out.push(x);
  }
  return xs.filter((x) => out.includes(x));
};
const clone = (v) => JSON.parse(JSON.stringify(v));

const M = 60_000;
const H = 60 * M;
const DAY = 24 * H;
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

/** @type {Record<string, { args: unknown[], out: unknown }[]>} */
const cases = {};
const add = (name, args, out) => (cases[name] ??= []).push({ args: clone(args), out: out === undefined ? null : clone(out) });
// Async functions get their slot now and their output once awaited, so the order stays fixed.
const pending = [];
const addAsync = (name, args, promise) => {
  const slot = { args: clone(args), out: null };
  (cases[name] ??= []).push(slot);
  pending.push(promise.then((out) => (slot.out = clone(out))));
};

// Times: ordinary days, the 2026 DST changes in Berlin (29 Mar, 25 Oct), and ISO year edges.
const TIMES = [
  at(2026, 11, 9, 11), at(2026, 11, 6, 11), at(2026, 11, 7, 23, 59, 59), at(2026, 11, 8, 0, 0, 1),
  at(2026, 3, 29, 1, 30), at(2026, 3, 29, 3, 30), at(2026, 3, 28, 23), at(2026, 3, 30, 9),
  at(2026, 10, 25, 1, 30), at(2026, 10, 25, 2, 30), at(2026, 10, 25, 23), at(2026, 10, 26, 9),
  at(2025, 12, 29, 12), at(2026, 1, 1, 0, 30), at(2027, 1, 3, 22), at(2027, 1, 4, 8), at(2020, 12, 31, 12),
  at(2021, 1, 3, 12), at(2024, 2, 29, 17), at(2026, 6, 15, 8, 59), at(2026, 6, 15, 17), at(2026, 6, 13, 10),
];
for (let i = 0; i < 40; i++) TIMES.push(at(2025, 1, 1) + int(0, 3 * 365) * DAY + int(0, DAY - 1));

const WORKDAY_SETS = [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4], [6], [], [0, 1, 2, 3, 4, 5, 6], [2, 4]];
const HOURS = [
  { activeStart: "09:00", activeEnd: "17:00" },
  { activeStart: "08:30", activeEnd: "18:15" },
  { activeStart: "00:00", activeEnd: "23:59" },
  { activeStart: "12:17", activeEnd: "17:00" },
  { activeStart: "02:00", activeEnd: "03:00" }, // spans the spring-forward gap
];
const hoursFor = () => ({ ...pick(HOURS), workdays: pick(WORKDAY_SETS) });

// ---------------------------------------------------------------- store.js

add("store.constants", [], { SETTINGS_DEFAULTS: store.SETTINGS_DEFAULTS, LOG_MAX: store.LOG_MAX });

// ---------------------------------------------------------------- auth.js

for (const email of ["sam@acme.io", "Sam@ACME.IO", "sam@gmail.com", "x@GoogleMail.com", "a@b@corp.example", "@corp.com", "nobody", "", null, "a@", "a@proton.me", "a@sub.mail.com"]) {
  add("auth.companyFromEmail", [email], auth.companyFromEmail(email));
}

// ---------------------------------------------------------------- xp.js

for (const v of [0, 1, 99, 100, 175, 249, 250, 499, 500, 899, 900, 1399, 1400, 1999, 2000, 2999, 3000, 5000]) add("xp.levelFor", [v], xp.levelFor(v));
for (const t of TIMES) {
  add("xp.dayKey", [t], xp.dayKey(t));
  add("xp.isoWeek", [t], xp.isoWeek(t));
  add("xp.isoWeekNumber", [t], xp.isoWeekNumber(t));
}

const scoresOf = (n) => Array.from({ length: n }, () => pick([45, 60, 70, 75, 80, 85, 88, 90, 92, 95, 100, int(0, 100)]));
const results = [
  { countedReps: 18, targetReps: 18, scores: Array(18).fill(100) },
  { countedReps: 9, targetReps: 18, scores: Array(9).fill(80) },
  { countedReps: 0, targetReps: 18, scores: [] },
  { countedReps: 3, targetReps: 0, scores: [90] },
  { countedReps: 20, targetReps: 18, scores: [50, 51] }, // completion capped at 1
  { countedReps: 9, targetReps: 18, scores: [90] }, // 4.5 rounds up
];
for (let i = 0; i < 30; i++) {
  const target = pick([6, 12, 18]);
  const counted = int(0, target);
  results.push({ countedReps: counted, targetReps: target, scores: scoresOf(int(0, counted)) });
}
for (const r of results) add("xp.breakXp", [r], xp.breakXp(r));

const AREA_KEYS = {
  "Neck tension": ["neck_tilt", "head_turn", "chin_to_chest", "shoulder_shrug", "chin_tuck"],
  "Rounded shoulders": ["cross_swing", "wy_raise", "shoulder_roll", "thoracic_extension", "clasp_opener"],
  "Upper back": ["seated_row", "t_raise", "desk_punch", "rhomboid_stretch", "desk_row"],
  "Shoulder & rotator cuff": ["scaption", "front_raise", "overhead_reach", "external_rotation", "cross_body_stretch"],
  "Lower back": ["seated_side_bend", "knee_to_chest", "hip_hinge", "standing_side_bend", "back_extension"],
  "Wrist & hand": ["wrist_flex", "extensor_stretch", "flexor_stretch", "prayer_stretch", "nerve_glide"],
  Knees: ["seated_knee_ext", "heel_slide", "sit_to_stand", "mini_squat", "hamstring_curl"],
  Eyes: ["palming", "temple_massage", "look_far", "near_far_focus", "eye_track_vertical"],
};
const SIDE_ON = new Set(["chin_tuck", "thoracic_extension", "clasp_opener", "seated_row", "desk_punch", "desk_row", "front_raise",
  "knee_to_chest", "hip_hinge", "back_extension", "wrist_flex", "seated_knee_ext", "heel_slide", "sit_to_stand", "mini_squat"]);
const STANDING = new Set(["clasp_opener", "desk_row", "hip_hinge", "standing_side_bend", "back_extension", "sit_to_stand", "mini_squat"]);
const CATALOG = Object.entries(AREA_KEYS).flatMap(([category, keys], ai) =>
  keys.map((key, k) => ({
    key,
    label: `Label ${key}`,
    metric: "Angle",
    category,
    camera: SIDE_ON.has(key) ? "side" : "front",
    how_to: `do ${key}`,
    ...(ai % 3 === 2 && k === 1 ? {} : { stance: STANDING.has(key) ? "standing" : "seated" }), // missing stance -> seated
    demo: k === 0 ? { youtube_id: "dQw4w9WgXcQ", start: 3, end: 9, title: `${key} demo` } : null,
  })),
);

const blankProfile = () => ({
  playerId: "p", secret: "s", xp: 0, streak: 0, lastStreakDay: null, lastBreakDay: null,
  weekXp: 0, week: null, badges: [], daily: null, weekly: null,
});
const randomResult = () => {
  const moves = routine.buildRoutine(CATALOG, { areas: subset(routine.AREAS, 1), lastKey: null, n: int(0, 9) });
  const progress = moves.map((m) => int(0, m.target));
  const scores = progress.flatMap((r) => scoresOf(r));
  return {
    scored: scores.length > 0 && rand() < 0.9,
    countedReps: progress.reduce((a, b) => a + b, 0),
    targetReps: moves.reduce((n, m) => n + m.target, 0),
    scores,
    moves: moves.map((m, k) => ({ key: m.key, area: m.area, completed: progress[k] >= m.target })),
  };
};

// Whole weeks of breaks, so streaks, daily challenges, weekly areas and level-ups all happen.
for (let run = 0; run < 6; run++) {
  const workdays = pick(WORKDAY_SETS.slice(0, 5));
  let profile = { ...blankProfile(), xp: pick([0, 95, 480, 2990]) };
  let now = at(2026, pick([3, 10, 11, 12]), int(1, 20), 7, 30);
  for (let b = 0; b < 45; b++) {
    now += pick([20 * M, 45 * M, 2 * H, 9 * H, DAY, 2 * DAY + 3 * H, 3 * DAY]);
    if (rand() < 0.15) {
      const action = pick(["snooze", "skip", "close", "pause", "done"]);
      add("challenges.noteAction", [profile, action, now], challenges.noteAction(profile, action, now));
      profile = challenges.noteAction(profile, action, now);
      continue;
    }
    const result = randomResult();
    const out = xp.award(profile, result, now, workdays);
    add("xp.award", [profile, result, now, workdays], out);
    profile = out.profile;
  }
}
// The extension's own award checks.
{
  const fri = at(2026, 11, 6, 11);
  const mon = at(2026, 11, 9, 11);
  const full = { scored: true, countedReps: 18, targetReps: 18, scores: Array(18).fill(100), moves: [{ key: "neck_tilt", area: "Neck tension", completed: true }] };
  const ids = challenges.dailyFor(mon);
  const quiet = { daily: { day: xp.dayKey(mon), ids, areas: [], breaks: 0, run: 0, done: ids }, weekly: { week: xp.isoWeek(mon), area: routine.featuredArea(mon), count: 10, done: true } };
  const W = [1, 2, 3, 4, 5];
  for (const [p, r, t] of [
    [{ ...blankProfile(), ...quiet, xp: 95, streak: 2, lastStreakDay: xp.dayKey(fri) }, full, mon],
    [{ ...blankProfile(), xp: 40, streak: 4, lastStreakDay: xp.dayKey(fri) }, { ...full, scored: false }, mon],
    [{ ...blankProfile(), streak: 5, lastStreakDay: xp.dayKey(fri - DAY) }, full, mon],
    [{ ...blankProfile(), week: "2026-W45", weekXp: 200 }, full, mon],
    [{ ...blankProfile(), streak: 3, lastStreakDay: xp.dayKey(fri) }, full, at(2026, 11, 7, 11)],
    [{ ...blankProfile(), weekly: { week: xp.isoWeek(mon), area: "Hips & glutes", count: 4, done: false } }, full, mon],
  ]) add("xp.award", [p, r, t, W], xp.award(p, r, t, W));
  add("xp.award", [{ ...blankProfile(), streak: 2, lastStreakDay: "2026-11-01" }, full, mon, []], xp.award({ ...blankProfile(), streak: 2, lastStreakDay: "2026-11-01" }, full, mon, []));
}

// ---------------------------------------------------------------- challenges.js

for (let d = 0; d < 70; d++) {
  const t = at(2026, 9, 1, 12) + d * DAY;
  add("challenges.dailyFor", [t], challenges.dailyFor(t));
}
for (const t of TIMES.slice(0, 20)) {
  add("challenges.withPeriods", [blankProfile(), t], challenges.withPeriods(blankProfile(), t));
  const stale = { ...blankProfile(), daily: { day: "2020-01-01", ids: ["variety"], areas: [], breaks: 3, run: 2, done: [] }, weekly: { week: xp.isoWeek(t), area: "Legs & circulation", count: 3, done: false } };
  add("challenges.withPeriods", [stale, t], challenges.withPeriods(stale, t));
}

// ---------------------------------------------------------------- routine.js

add("routine.constants", [], { AREAS: routine.AREAS, BREAK_REPS: routine.BREAK_REPS });
for (const areas of [[], ["Neck"], ["Neck", "Neck tension", "Arms & wrists"], ["Hips & glutes", "Eyes"], ["Nope", "Knees"], [...routine.AREAS].reverse(), ["Upper back & posture", "Legs & circulation", "Lower back & core", "Shoulders"]]) {
  add("routine.currentAreas", [areas], routine.currentAreas(areas));
}
for (let w = 0; w < 30; w++) {
  const t = at(2026, 1, 5, 12) + w * 7 * DAY + int(0, 6) * DAY;
  add("routine.featuredArea", [t], routine.featuredArea(t));
}
// Routine cases name their catalog by its index in the fixture's `catalogs`, to keep the file small.
const catalogs = [CATALOG, CATALOG.filter((e) => e.category !== "Knees"), CATALOG.slice(0, 7), []];
for (let i = 0; i < 60; i++) {
  const ci = int(0, catalogs.length - 1);
  const catalog = catalogs[ci];
  const areas = rand() < 0.1 ? [] : subset(routine.AREAS, 1);
  const lastKey = rand() < 0.5 ? pick(CATALOG).key : null;
  const n = int(0, 30);
  const moves = routine.buildRoutine(catalog, { areas, lastKey, n });
  add("routine.buildRoutine", [ci, { areas, lastKey, n }], moves);
  for (let k = 0; k < moves.length; k++) add("routine.swapMove", [ci, moves, k], routine.swapMove(catalog, moves, k));
  const progress = moves.map((m) => ({ reps: pick([0, int(0, m.target), m.target]), scores: [] }));
  for (let k = 0; k < moves.length; k++) add("routine.nextOpenMove", [moves, progress, k], routine.nextOpenMove(moves, progress, k));
}
for (const e of CATALOG) {
  const move = routine.buildRoutine([e], { areas: [e.category], lastKey: null, n: 0 })[0];
  add("routine.needsPositioning", [move], routine.needsPositioning(move));
}

// ---------------------------------------------------------------- schedule.js

add("schedule.constants", [], {
  SNOOZE_MIN: schedule.SNOOZE_MIN, SNOOZE_CAP: schedule.SNOOZE_CAP, WARN_SKIPS: schedule.WARN_SKIPS, PAUSE_MIN: schedule.PAUSE_MIN,
  LATE_MS: schedule.LATE_MS, DEFER_MIN: schedule.DEFER_MIN, IDLE_SEC: schedule.IDLE_SEC,
});
const randomSchedule = (now) => ({
  ...schedule.initialSchedule(now - int(0, 3) * H, pick([30, 45, 60, 90])),
  nextAt: now + int(-90, 90) * M,
  skipsInRow: int(0, 4),
  snoozesInRow: int(0, 2),
  pausedUntil: rand() < 0.2 ? now + int(1, 60) * M : 0,
  windowId: rand() < 0.5 ? int(1, 9) : null,
  lastKey: rand() < 0.5 ? "neck_tilt" : null,
  breakCount: int(0, 40),
  shiftedBy: pick([0, 20]),
  deferredFrom: rand() < 0.3 ? now - int(0, 40) * M : null,
  ...(rand() < 0.3 ? { extraWindowId: int(1, 9) } : {}),
});
for (const t of TIMES.slice(0, 10)) for (const iv of [1, 30, 60, 240]) add("schedule.initialSchedule", [t, iv], schedule.initialSchedule(t, iv));
for (let i = 0; i < 40; i++) {
  const now = pick(TIMES) + int(0, 59) * M;
  const s = randomSchedule(now);
  const iv = pick([1, 30, 45, 60, 90, 240]);
  add("schedule.onFire", [s, now, iv], schedule.onFire(s, now, iv));
  add("schedule.canSnooze", [s], schedule.canSnooze(s));
  add("schedule.showWarning", [s], schedule.showWarning(s));
  for (const action of ["done", "skip", "close", "snooze", "pause", "bogus"]) add("schedule.applyAction", [s, action, now, iv], schedule.applyAction(s, action, now, iv));
  add("schedule.rescheduleForInterval", [s, now, iv], schedule.rescheduleForInterval(s, now, iv));
  add("schedule.upcoming", [s, iv, 3], schedule.upcoming(s, iv, 3));
}
add("schedule.canSnooze", [{}], schedule.canSnooze({}));
add("schedule.showWarning", [{}], schedule.showWarning({}));
for (const [skips, iv] of [[3, 60], [3, 45], [4, 90], [5, 20], [3, 1], [7, 240]]) add("schedule.warningHours", [skips, iv], schedule.warningHours(skips, iv));
for (let i = 0; i < 120; i++) {
  const hours = hoursFor();
  const t = pick(TIMES) + int(-3, 3) * H + int(0, 59) * M;
  add("schedule.isActive", [t, hours], schedule.isActive(t, hours));
  const iv = pick([30, 60, 90]);
  add("schedule.nextActiveSlot", [t, iv, hours], schedule.nextActiveSlot(t, iv, hours));
}
for (let i = 0; i < 150; i++) {
  const now = pick(TIMES) + int(-2, 2) * H + int(0, 59) * M;
  const s = randomSchedule(now);
  const settings = { ...hoursFor(), autoPause: rand() < 0.7 };
  const ctx = { idle: pick(["active", "active", "idle", "locked"]), meeting: rand() < 0.3, settings };
  const iv = pick([30, 60, 90]);
  add("schedule.decideFire", [s, now, iv, ctx], schedule.decideFire(s, now, iv, ctx));
}
{
  const base = { intervalMin: 60, activeStart: "09:00", activeEnd: "17:00", workdays: [1, 2, 3, 4, 5], privacy: true, mode: "personal" };
  for (const next of [{}, { privacy: false, mode: "competitive" }, { workdays: [6] }, { activeStart: "12:17" }, { activeEnd: "18:00" }, { intervalMin: 30 }, { workdays: [5, 4, 3, 2, 1] }, { workdays: [1, 2, 3, 4] }]) {
    add("schedule.scheduleSettingsChanged", [base, { ...base, ...next }], schedule.scheduleSettingsChanged(base, { ...base, ...next }));
  }
}
for (let d = 0; d < 7; d++) add("schedule.weekOrder", [d], schedule.weekOrder(d));
for (const ms of [-5, 0, 1, 999, 1000, 1001, 59_000, 59_999, 60_000, 60_001, 119_999, 5_940_000, 5_999_999, 6_000_000, 6_000_001, 9 * H, 9.6 * H, 20 * H]) {
  add("schedule.countdownText", [ms], schedule.countdownText(ms));
}

// ---------------------------------------------------------------- activity.js

{
  let act = null;
  const log = [];
  let now = at(2025, 10, 1, 10);
  for (let i = 0; i < 60; i++) {
    now += pick([H, 3 * H, DAY, 5 * DAY, 40 * DAY]);
    const gained = pick([0, 5, 12, undefined, null]);
    add("activity.recordActivity", [act, now, gained], activity.recordActivity(act, now, gained));
    act = activity.recordActivity(act, now, gained);
    log.push({ at: now, xp: gained });
  }
  add("activity.backfillActivity", [log], activity.backfillActivity(log));
  add("activity.backfillActivity", [[]], activity.backfillActivity([]));
}

// ---------------------------------------------------------------- memes.js

add("memes.MEMES", [], memes.MEMES);
for (const kind of Object.keys(memes.MEMES)) {
  for (const turn of [null, 0, 1, 5, 37, 38, 100, -1]) add("memes.takeTurn", [kind, turn], memes.takeTurn(memes.MEMES[kind], turn));
}
for (const total of [0, 1, 2, 3, 6, 7, 12, 17, 18, 30]) for (const clips of [1, 2, 3]) add("memes.repMarks", [total, clips], memes.repMarks(total, clips));

// ---------------------------------------------------------------- server-status.js, badges.js

for (const code of [1000, 1001, 1006, 1011, 1013]) add("serverStatus.closeStatus", [code], serverStatus.closeStatus(code));
for (const lang of ["en", "ar"]) {
  for (const id of ["daily:variety", "daily:high_five", "daily:clean_form", "daily:early_mover", "daily:no_excuses", "daily:mystery", "weekly:Neck tension", "weekly:Eyes"]) {
    add("badges.badgeLabel", [id, lang], badges.badgeLabel(id, lang));
  }
}

// ---------------------------------------------------------------- sync-core.js

add("syncCore.constants", [], {
  OUTBOX_MAX: syncCore.OUTBOX_MAX, PUSH_BATCH: syncCore.PUSH_BATCH, PULL_LIMIT: syncCore.PULL_LIMIT, MIN_AT: syncCore.MIN_AT,
  SHARED_KEYS: syncCore.SHARED_KEYS, BACKFILL_NAMESPACE: syncCore.BACKFILL_NAMESPACE,
});
const NOW = at(2026, 11, 9, 12);
const entries = [
  { at: NOW - H, reps: 18, moves: 3, score: 91, xp: 18, scored: true, completed: true },
  { at: NOW - DAY, reps: 7, moves: 1, score: 77, xp: 4, scored: true, completed: false },
  { at: NOW - DAY, reps: -3, moves: 1000, score: 140, xp: 5000, scored: true, completed: false },
  { at: NOW - DAY, reps: 20_000, moves: -1, score: -4, xp: -2, scored: false, completed: true },
  { at: NOW - DAY, reps: 4, moves: 2, score: null, xp: 0, scored: false, completed: false },
  { at: syncCore.MIN_AT - 1, reps: 1, moves: 1, score: 50, xp: 1, scored: true, completed: true },
  { at: syncCore.MIN_AT, reps: 1, moves: 1, score: 50, xp: 1, scored: true, completed: true },
  { at: NOW + 25 * H, reps: 1, moves: 1, score: 50, xp: 1, scored: true, completed: true },
  { at: NOW + 23 * H, reps: 1, moves: 1, score: 50, xp: 1, scored: true, completed: true },
  { at: at(2026, 10, 25, 2, 30), reps: 6, moves: 1, score: 80, xp: 8, scored: true, completed: true },
];
for (const e of entries) {
  for (const areas of [[], ["Neck tension", "", "x".repeat(41), "Knees"], undefined]) {
    add("syncCore.breakEvent", [e, { id: "id-1", areas, device: "mac", now: NOW }], syncCore.breakEvent(e, { id: "id-1", areas, device: "mac", now: NOW }));
  }
}
for (const [name, ns] of [["p:1700000000000", syncCore.BACKFILL_NAMESPACE], ["", syncCore.BACKFILL_NAMESPACE], ["héllo wörld", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"]]) {
  addAsync("syncCore.uuidv5", [name, ns], syncCore.uuidv5(name, ns));
}
{
  const log = [
    { at: NOW - 3 * DAY, reps: 6, moves: 1, score: 80, xp: 7, scored: true, completed: true },
    { at: NOW - 2 * DAY, reps: 6, moves: 1, score: 80, xp: 7, scored: true, completed: true, id: "keep-me", areas: ["Knees"] },
    { at: NOW - DAY, reps: 6, moves: 1, score: 80, xp: 7, scored: true, completed: true, id: "pulled", device: "ios" },
    { at: 5, reps: 6, moves: 1, score: 80, xp: 7, scored: true, completed: true },
  ];
  addAsync("syncCore.backfillEvents", [log, "player-1", NOW], syncCore.backfillEvents(log, "player-1", NOW));
}
{
  const ev = (id) => ({ id, at: NOW, reps: 1 });
  add("syncCore.addToOutbox", [[ev("a"), ev("b")], [ev("b"), ev("c"), null, ev("c")]], syncCore.addToOutbox([ev("a"), ev("b")], [ev("b"), ev("c"), null, ev("c")]));
  const big = Array.from({ length: syncCore.OUTBOX_MAX }, (_, k) => ({ id: `o${k}` }));
  const grown = syncCore.addToOutbox(big, [{ id: "new1" }, { id: "new2" }]);
  add("syncCore.addToOutbox.capped", [syncCore.OUTBOX_MAX, ["new1", "new2"]], { length: grown.length, first: grown[0].id, last: grown.at(-1).id });
  add("syncCore.removeFromOutbox", [[ev("a"), ev("b"), ev("c")], ["b", "z"]], syncCore.removeFromOutbox([ev("a"), ev("b"), ev("c")], ["b", "z"]));
}
{
  const prev = { intervalMin: 60, areas: ["Knees"], activeStart: "09:00", activeEnd: "17:00", workdays: [1, 2, 3, 4, 5], autoPause: true, voice: true, memes: true, mode: "personal", name: "", avatar: "bunny", lang: "auto", weekStart: 1, privacy: true, theme: "auto" };
  for (const next of [{}, { privacy: false, theme: "dark" }, { intervalMin: 45, voice: false }, { areas: ["Knees"] }, { areas: ["Eyes", "Knees"], name: "Sam", workdays: [1, 2, 3, 4, 5] }, { weekStart: 0, lang: "ar", serverUrl: "ws://x" }]) {
    add("syncCore.changedSharedKeys", [prev, next], syncCore.changedSharedKeys(prev, next));
  }
  add("syncCore.markDirty", [{ voice: 5 }, ["intervalMin", "voice"], 9], syncCore.markDirty({ voice: 5 }, ["intervalMin", "voice"], 9));
  add("syncCore.markDirty", [{ voice: 5 }, [], 9], syncCore.markDirty({ voice: 5 }, [], 9));
  const settings = { ...prev, intervalMin: 300, name: "  " + "n".repeat(39) + "  ", avatar: "Bunny", lang: "pt-BR", workdays: [1, 1], areas: ["x".repeat(41)] };
  for (const dirty of [{}, { voice: NOW, memes: NOW, mode: NOW - 5 }, { intervalMin: NOW, name: NOW, avatar: NOW, lang: NOW, workdays: NOW, areas: NOW }, { voice: 100, autoPause: 0, weekStart: NOW, bogus: NOW }]) {
    add("syncCore.dirtyPatches", [settings, dirty], syncCore.dirtyPatches(settings, dirty));
    add("syncCore.dirtyPatches", [prev, dirty], syncCore.dirtyPatches(prev, dirty));
  }
  add("syncCore.clearDirty", [{ a: 1, b: 5, c: 3 }, { a: 1, b: 4 }], syncCore.clearDirty({ a: 1, b: 5, c: 3 }, { a: 1, b: 4 }));
  add("syncCore.clearDirty", [null, { a: 1 }], syncCore.clearDirty(null, { a: 1 }));
  for (const doc of [{}, { intervalMin: 30, voice: false }, Object.fromEntries(syncCore.SHARED_KEYS.map((k) => [k, prev[k]]))]) {
    add("syncCore.seedPatch", [prev, doc], syncCore.seedPatch(prev, doc));
    add("syncCore.seedPatch", [{ ...prev, intervalMin: 0, lang: "Klingon!" }, doc], syncCore.seedPatch({ ...prev, intervalMin: 0, lang: "Klingon!" }, doc));
  }
  for (const [doc, dirty] of [
    [{ intervalMin: 45, voice: true, mode: "competitive", serverUrl: "ws://evil", privacy: false }, {}],
    [{ intervalMin: 45, voice: false, workdays: [0, 6] }, { voice: 1 }],
    [{ intervalMin: 999, avatar: "x", areas: ["Knees"] }, null],
    [null, {}],
  ]) add("syncCore.remotePatch", [prev, doc, dirty], syncCore.remotePatch(prev, doc, dirty));
}
{
  const daily = { day: "2026-11-09", ids: ["variety"], areas: [], breaks: 1, run: 1, done: [] };
  for (const p of [
    { badges: ["daily:variety", "weekly:Neck tension", " bad", "bad ", "x".repeat(61), "", "ok_1.2:&-", "a/b"], daily, weekly: null },
    { badges: Array.from({ length: 205 }, (_, k) => `b${k}`), daily: { ...daily, areas: Array(300).fill("Shoulder & rotator cuff") }, weekly: null },
    { daily: null, weekly: { week: "2026-W46", area: "Knees", count: 2, done: false } },
  ]) add("syncCore.progressOf", [p], syncCore.progressOf(p));
}
{
  const local = { ...blankProfile(), xp: 50, streak: 1, lastStreakDay: "2026-11-05", lastBreakDay: "2026-11-05", weekXp: 10, week: "2026-W45", badges: ["a", "b"], daily: { day: "x", ids: ["variety"], areas: [], breaks: 1, run: 1, done: [] }, weekly: null };
  for (const server of [
    { xp: 120, streak: 3, week: "2026-W46", weekXp: 30, lastBreakDay: "2026-11-09", badges: ["b", "c"], daily: null, weekly: { week: "2026-W46", area: "Knees", count: 3, done: false } },
    { xp: 120, streak: 0, week: "2026-W46", weekXp: 30, lastBreakDay: "2026-11-09", badges: [], daily: { day: "y", ids: ["high_five"], areas: ["Knees"], breaks: 2, run: 0, done: [] }, weekly: null },
    { xp: 10, streak: 2, week: "2026-W45", weekXp: 10, lastBreakDay: "2026-11-01", badges: undefined },
    { xp: 10, streak: 2, week: "2026-W45", weekXp: 10, lastBreakDay: null },
  ]) {
    add("syncCore.mergeProfile", [local, server], syncCore.mergeProfile(local, server));
    add("syncCore.mergeProfile", [{ ...local, lastBreakDay: null, lastStreakDay: null, badges: undefined }, server], syncCore.mergeProfile({ ...local, lastBreakDay: null, lastStreakDay: null, badges: undefined }, server));
  }
  const entry = (at, xp, id) => ({ at, reps: 6, moves: 1, score: 80, xp, scored: true, completed: true, ...(id ? { id } : {}) });
  const log = [entry(30, 1, "a"), entry(10, 2), entry(20, 3, "c")];
  const events = [
    { id: "a", at: 30, reps: 1, moves: 1, score: 50, xp: 1, scored: true, completed: true, device: "ios", areas: [], day: "d", week: "w" },
    { id: "d", at: 15, reps: 2, moves: 1, score: null, xp: 4, scored: false, completed: false, device: "android", areas: ["Knees"], day: "d", week: "w" },
    { id: "d", at: 15, reps: 2, moves: 1, score: null, xp: 4, scored: false, completed: false, device: "android", areas: ["Knees"] },
    { id: "e", at: 5, reps: 3, moves: 1, score: 99, xp: 9, scored: true, completed: true, device: "chrome", areas: [] },
  ];
  for (const max of [500, 3]) add("syncCore.mergeLog", [log, events, max], syncCore.mergeLog(log, events, max));
  add("syncCore.mergeLog", [log, [events[0]], 500], syncCore.mergeLog(log, [events[0]], 500));
  for (const l of [log, [], [{ at: 7 }, { at: 3 }]]) add("syncCore.lastBreakAt", [l], syncCore.lastBreakAt(l));
}

// ---------------------------------------------------------------- i18n.js

const strings = Object.fromEntries(["en", "ar"].map((lang) => [lang, Object.fromEntries(i18n.translationKeys(lang).map((k) => [k, i18n.t(lang, k)]))]));
for (const [lang, key, vars] of [
  ["en", "level", { n: 3, name: "Stretch Rookie" }], ["ar", "level", { n: 3, name: "x" }], ["en", "level", {}], ["en", "level", { n: 0 }],
  ["ar", "no-such-key", {}], ["xx", "done", {}], ["en", "warnTitle", { n: 1.5 }], ["ar", "exerciseStep", { i: 2, n: 3 }],
]) add("i18n.t", [lang, key, vars], i18n.t(lang, key, vars));
for (const [setting, browser] of [["en", "ar-EG"], ["ar", "en-US"], ["auto", "ar-EG"], ["auto", "AR"], ["auto", "en-GB"], ["auto", undefined], ["fr", "fr-FR"]]) {
  add("i18n.resolveLang", [setting, browser ?? null], i18n.resolveLang(setting, browser));
}
for (const lang of ["en", "ar"]) {
  add("i18n.areaName", [lang, "Neck tension"], i18n.areaName(lang, "Neck tension"));
  add("i18n.areaName", [lang, "Nope"], i18n.areaName(lang, "Nope"));
  add("i18n.levelName", [lang, 4, "Desk Mover"], i18n.levelName(lang, 4, "Desk Mover"));
  add("i18n.exerciseText", [lang, "neck_tilt", "label", "Neck tilt"], i18n.exerciseText(lang, "neck_tilt", "label", "Neck tilt"));
  add("i18n.exerciseText", [lang, "nope", "how_to", "Fallback"], i18n.exerciseText(lang, "nope", "how_to", "Fallback"));
  add("i18n.issueText", [lang, "too_fast", "Slow down"], i18n.issueText(lang, "too_fast", "Slow down"));
}

await Promise.all(pending);
const sorted = Object.fromEntries(Object.keys(cases).sort().map((k) => [k, cases[k]]));
const files = [
  [OUT, `${JSON.stringify({ tz: process.env.TZ, generatedBy: "macos/scripts/parity-fixtures.mjs", catalogs, cases: sorted })}\n`],
  [STRINGS_OUT, `${JSON.stringify(strings, null, 1)}\n`],
];

if (process.argv.includes("--check")) {
  const stale = files.filter(([path, text]) => {
    try {
      return readFileSync(path, "utf8") !== text;
    } catch {
      return true;
    }
  });
  for (const [path] of stale) console.log(`out of date: ${path.slice(ROOT.length + 1)}`);
  if (stale.length) console.log("Run: node macos/scripts/parity-fixtures.mjs");
  process.exitCode = stale.length ? 1 : 0;
} else {
  for (const [path, text] of files) writeFileSync(path, text);
  console.log(`${Object.values(sorted).reduce((n, c) => n + c.length, 0)} cases in ${Object.keys(sorted).length} functions`);
}
