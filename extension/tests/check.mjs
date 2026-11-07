import assert from "node:assert/strict";
import { LEVELS, levelFor, breakXp, award, dayKey, isoWeek } from "../lib/xp.js";
import { AREAS, BREAK_REPS, buildRoutine, swapMove, needsPositioning, featuredArea } from "../lib/routine.js";
import {
  SNOOZE_CAP, initialSchedule, onFire, applyAction, canSnooze, showWarning, warningHours, upcoming, rescheduleForInterval,
} from "../lib/schedule.js";
import { toPayload, fetchBoard, submitScore } from "../lib/leaderboard.js";

function check(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

const M = 60_000;
const H = 60 * M;
const DAY = 24 * H;
const fri = new Date(2026, 10, 6, 11).getTime();
const mon = new Date(2026, 10, 9, 11).getTime();
const WORKDAYS = [1, 2, 3, 4, 5];

const AREA_KEYS = {
  Neck: ["neck_tilt", "head_turn"],
  Shoulders: ["overhead_reach", "alt_reach", "t_raise", "front_raise"],
  "Upper back & posture": ["seated_row", "cross_swing", "desk_punch", "desk_pushup"],
  "Arms & wrists": ["wrist_flex", "air_curl", "triceps_reach", "chair_dip"],
  "Lower back & core": ["seated_side_bend", "seated_lean_back", "standing_side_bend", "hip_hinge"],
  "Hips & glutes": ["sit_to_stand", "mini_squat", "side_leg_raise", "reverse_lunge", "leg_swing"],
  "Legs & circulation": ["seated_knee_ext", "seated_knee_lift", "seated_heel_raise", "calf_raise", "march", "hamstring_curl", "step_jack"],
};
const CATALOG = Object.entries(AREA_KEYS).flatMap(([category, keys]) =>
  keys.map((key) => ({
    key,
    label: key,
    category,
    camera: ["Hips & glutes", "Legs & circulation"].includes(category) ? "side" : "front",
    how_to: `do ${key}`,
    demo: null,
  })),
);

const blankProfile = () => ({
  playerId: "p",
  secret: "s",
  xp: 0,
  streak: 0,
  lastStreakDay: null,
  lastBreakDay: null,
  weekXp: 0,
  week: null,
  badges: [],
  daily: null,
  weekly: null,
});
const full = () => ({
  scored: true,
  countedReps: 18,
  targetReps: 18,
  scores: Array(18).fill(100),
  moves: [{ key: "neck_tilt", area: "Neck", completed: true }],
});

check("levels", () => {
  assert.equal(LEVELS.length, 8);
  assert.equal(levelFor(0).name, "Desk Potato");
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).name, "Chair Escapee");
  assert.equal(levelFor(3000).name, "Movement Master");
  assert.equal(levelFor(3000).next, null);
  assert.equal(levelFor(3000).progress, 1);
  assert.equal(levelFor(175).progress, 0.5);
});

check("breakXp", () => {
  assert.equal(breakXp({ countedReps: 18, targetReps: 18, scores: Array(18).fill(100) }), 10);
  assert.equal(breakXp({ countedReps: 9, targetReps: 18, scores: Array(9).fill(80) }), 4);
  assert.equal(breakXp({ countedReps: 0, targetReps: 18, scores: [] }), 0);
});

check("isoWeek and dayKey", () => {
  assert.equal(isoWeek(mon), "2026-W46");
  assert.equal(isoWeek(fri), "2026-W45");
  assert.equal(dayKey(fri), "2026-11-06");
});

check("award: first scored break of day gets bonuses, streak continues from previous workday", () => {
  const p0 = { ...blankProfile(), xp: 95, streak: 2, lastStreakDay: dayKey(fri) };
  const { profile, breakdown, levelUp } = award(p0, full(), mon, WORKDAYS);
  assert.equal(profile.streak, 3);
  assert.deepEqual([breakdown.breakXp, breakdown.firstBreak, breakdown.streak], [10, 5, 3]);
  assert.equal(breakdown.total, 18);
  assert.equal(profile.xp, 113);
  assert.deepEqual(levelUp, { from: 1, to: 2, name: "Chair Escapee" });
  assert.equal(p0.xp, 95);
  assert.equal(p0.streak, 2);
});

check("award: second break same day has no bonus", () => {
  const first = award(blankProfile(), full(), mon, WORKDAYS).profile;
  const { breakdown, profile } = award(first, full(), mon + H, WORKDAYS);
  assert.equal(breakdown.total, 10);
  assert.equal(profile.streak, 1);
});

check("award: unscored Done earns nothing", () => {
  const p0 = { ...blankProfile(), xp: 40, streak: 4, lastStreakDay: dayKey(fri) };
  const { breakdown, profile, levelUp } = award(p0, { ...full(), scored: false }, mon, WORKDAYS);
  assert.equal(breakdown.total, 0);
  assert.equal(profile.xp, 40);
  assert.equal(profile.streak, 4);
  assert.equal(profile.lastBreakDay, dayKey(mon));
  assert.equal(levelUp, null);
});

check("award: gap of a workday resets streak to 1", () => {
  const thu = fri - DAY;
  const p0 = { ...blankProfile(), streak: 5, lastStreakDay: dayKey(thu) };
  assert.equal(award(p0, full(), mon, WORKDAYS).profile.streak, 1);
});

check("award: new ISO week resets weekXp", () => {
  const p0 = { ...blankProfile(), week: "2026-W45", weekXp: 200 };
  const { profile, breakdown } = award(p0, full(), mon, WORKDAYS);
  assert.equal(profile.week, "2026-W46");
  assert.equal(profile.weekXp, breakdown.total);
});

check("routine: featured slot first, no dupes, rest from user areas", () => {
  const moves = buildRoutine(CATALOG, { areas: ["Neck", "Shoulders"], featured: "Hips & glutes", lastKey: null, n: 0 });
  assert.equal(moves.length, 3);
  assert.equal(moves[0].area, "Hips & glutes");
  assert.equal(new Set(moves.map((m) => m.key)).size, 3);
  assert.ok(moves.slice(1).every((m) => ["Neck", "Shoulders"].includes(m.area)));
  assert.ok(moves.every((m) => m.target === BREAK_REPS && m.how_to && m.label));
});

check("routine: avoids lastKey in slot 1", () => {
  const opts = { areas: ["Neck"], featured: "Neck", lastKey: null, n: 0 };
  const first = buildRoutine(CATALOG, opts)[0].key;
  assert.notEqual(buildRoutine(CATALOG, { ...opts, lastKey: first })[0].key, first);
});

check("routine: all slots from user areas when featured is one of them", () => {
  const moves = buildRoutine(CATALOG, { areas: ["Neck", "Shoulders"], featured: "Shoulders", lastKey: null, n: 1 });
  assert.equal(moves.length, 3);
  assert.ok(moves.every((m) => ["Neck", "Shoulders"].includes(m.area)));
});

check("swapMove returns same-area exercise not already in routine; null when area exhausted", () => {
  const moves = buildRoutine(CATALOG, { areas: ["Neck", "Shoulders"], featured: "Shoulders", lastKey: null, n: 0 });
  const i = moves.findIndex((m) => m.area === "Shoulders");
  const swapped = swapMove(CATALOG, moves, i);
  assert.equal(swapped.area, "Shoulders");
  assert.ok(!moves.some((m) => m.key === swapped.key));
  const neck = buildRoutine(CATALOG, { areas: ["Neck"], featured: "Neck", lastKey: null, n: 0 });
  assert.equal(neck.length, 2);
  assert.equal(swapMove(CATALOG, neck, 0), null);
});

check("needsPositioning", () => {
  const byKey = (k) => buildRoutine(CATALOG, { areas: [CATALOG.find((e) => e.key === k).category], featured: CATALOG.find((e) => e.key === k).category, lastKey: null, n: 0 })[0];
  assert.equal(needsPositioning(byKey("sit_to_stand")), true);
  assert.equal(needsPositioning(byKey("neck_tilt")), false);
});

check("featuredArea rotates weekly over AREAS", () => {
  assert.ok(AREAS.includes(featuredArea(mon)));
  assert.notEqual(featuredArea(mon), featuredArea(mon + 7 * DAY));
  assert.equal(AREAS.length, 7);
});

const T0 = new Date(2026, 10, 9, 9).getTime();
const fired = () => onFire(initialSchedule(T0, 60), T0 + H, 60);

check("schedule: initial and onFire keep the grid", () => {
  assert.equal(initialSchedule(T0, 60).nextAt, T0 + H);
  assert.equal(fired().nextAt, T0 + 2 * H);
});

check("done keeps grid", () => {
  assert.equal(applyAction(fired(), "done", T0 + H + 5 * M, 60).nextAt, T0 + 2 * H);
});

check("snooze shifts to now+20 and counts", () => {
  const s = applyAction(fired(), "snooze", T0 + H + M, 60);
  assert.equal(s.nextAt, T0 + H + 21 * M);
  assert.equal(s.snoozesInRow, 1);
  assert.equal(s.shiftedBy, 20);
});

check("snooze capped at 2", () => {
  const s1 = applyAction(fired(), "snooze", T0 + H + M, 60);
  const s2 = applyAction(onFire(s1, s1.nextAt, 60), "snooze", s1.nextAt + M, 60);
  assert.equal(s2.snoozesInRow, SNOOZE_CAP);
  assert.equal(canSnooze(s2), false);
  const s3 = applyAction(s2, "snooze", s2.nextAt + M, 60);
  assert.equal(s3.nextAt, s2.nextAt);
  assert.equal(s3.snoozesInRow, 2);
});

check("skip keeps grid and counts", () => {
  const s = applyAction({ ...fired(), snoozesInRow: 1 }, "skip", T0 + H + M, 60);
  assert.equal(s.nextAt, T0 + 2 * H);
  assert.equal(s.skipsInRow, 1);
  assert.equal(s.snoozesInRow, 0);
});

check("done resets skips and snoozes", () => {
  const s = applyAction({ ...fired(), skipsInRow: 4, snoozesInRow: 2, shiftedBy: 20 }, "done", T0 + H + M, 60);
  assert.deepEqual([s.skipsInRow, s.snoozesInRow, s.shiftedBy], [0, 0, 0]);
});

check("close counts as skip once", () => {
  const s = applyAction({ ...fired(), windowId: 7 }, "close", T0 + H + M, 60);
  assert.equal(s.skipsInRow, 1);
  assert.equal(s.windowId, null);
  assert.equal(applyAction(s, "close", T0 + H + M, 60).skipsInRow, 1);
});

check("close after done is ignored", () => {
  const done = applyAction({ ...fired(), windowId: 7 }, "done", T0 + H + M, 60);
  assert.equal(applyAction(done, "close", T0 + H + 2 * M, 60).skipsInRow, 0);
});

check("warning after 3 skips; hours rounded to half hours", () => {
  assert.equal(showWarning({ ...fired(), skipsInRow: 2 }), false);
  assert.equal(showWarning({ ...fired(), skipsInRow: 3 }), true);
  assert.equal(warningHours(3, 60), 3);
  assert.equal(warningHours(3, 45), 2.5);
  assert.equal(warningHours(3, 30), 1.5);
});

check("pause 1hr keeps counters", () => {
  const s = applyAction({ ...fired(), skipsInRow: 3, snoozesInRow: 1 }, "pause", T0 + H + M, 60);
  assert.equal(s.nextAt, T0 + H + 61 * M);
  assert.equal(s.pausedUntil, T0 + H + 61 * M);
  assert.deepEqual([s.skipsInRow, s.snoozesInRow], [3, 1]);
});

check("rescheduleForInterval", () => {
  assert.equal(rescheduleForInterval(fired(), T0 + H + 10 * M, 30).nextAt, T0 + H + 40 * M);
});

check("upcoming after snooze lists shifted times", () => {
  const now = T0 + H + M;
  const s = applyAction(fired(), "snooze", now, 60);
  assert.deepEqual(upcoming(s, 60, 3), [now + 20 * M, now + 80 * M, now + 140 * M]);
});

check("leaderboard payload maps fields, lowercases company, zeroes stale week", () => {
  const profile = { ...blankProfile(), playerId: "id1", secret: "sec", xp: 260, streak: 4, weekXp: 40, week: "2026-W45" };
  const settings = { name: "Malik", company: "LeadLiaison.COM" };
  assert.deepEqual(toPayload(profile, settings, false, fri), {
    p_id: "id1", p_secret: "sec", p_name: "Malik", p_company: "leadliaison.com", p_xp: 260, p_level: 3,
    p_streak: 4, p_week_xp: 40, p_week: "2026-W45", p_delete: false,
  });
  const stale = toPayload(profile, settings, true, mon);
  assert.equal(stale.p_week, "2026-W46");
  assert.equal(stale.p_week_xp, 0);
  assert.equal(stale.p_delete, true);
});

const pending = [];
check("leaderboard unconfigured resolves null/false without throwing", () => {
  pending.push(
    fetchBoard("x.com", "week", "id", { url: "", key: "" }).then((r) => assert.equal(r, null)),
    submitScore(blankProfile(), { mode: "competitive", name: "a", company: "x.com" }, { remove: false }, { url: "", key: "" }).then((r) => assert.equal(r, false)),
  );
});
Promise.all(pending).then(
  () => console.log("ok leaderboard async checks"),
  (err) => {
    console.log(`FAIL leaderboard async checks\n  ${err.message}`);
    process.exitCode = 1;
  },
);
