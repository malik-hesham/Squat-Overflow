import assert from "node:assert/strict";
import { LEVELS, levelFor, breakXp, award, dayKey, isoWeek } from "../lib/xp.js";
import { AREAS, BREAK_REPS, buildRoutine, swapMove, needsPositioning, featuredArea, nextOpenMove } from "../lib/routine.js";
import {
  SNOOZE_CAP, initialSchedule, onFire, applyAction, canSnooze, showWarning, warningHours, upcoming, rescheduleForInterval,
  nextActiveSlot, decideFire, isActive, scheduleSettingsChanged,
} from "../lib/schedule.js";
import { toPayload, fetchBoard, submitScore } from "../lib/leaderboard.js";
import { DAILY_POOL, WEEKLY, dailyFor, updateChallenges, noteAction } from "../lib/challenges.js";
import { createSerial } from "../lib/serial.js";
import { THEMES, themeId } from "../lib/themes.js";
import { activityLevel, recordActivity, backfillActivity, heatmapWeeks, activityTotals } from "../lib/activity.js";
import { LANGS, resolveLang, t, exerciseText, areaName, levelName, issueText, localeFor, nameText, translationKeys } from "../lib/i18n.js";
import { badgeLabel } from "../lib/badges.js";
import { CALENDAR_SCOPE, buildAuthUrl, parseAuthResponse, busyNow, nextMeeting, parseBusy } from "../lib/calendar.js";

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
  const ids = dailyFor(mon);
  const quiet = { daily: { day: dayKey(mon), ids, areas: [], breaks: 0, run: 0, done: ids }, weekly: { week: isoWeek(mon), area: featuredArea(mon), count: 10, done: true } };
  const p0 = { ...blankProfile(), ...quiet, xp: 95, streak: 2, lastStreakDay: dayKey(fri) };
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
  const settings = { name: "Malik", company: "LeadLiaison.COM", avatar: "penguin" };
  assert.deepEqual(toPayload(profile, settings, false, fri), {
    p_id: "id1", p_secret: "sec", p_name: "Malik", p_company: "leadliaison.com", p_xp: 260, p_level: 3,
    p_streak: 4, p_week_xp: 40, p_week: "2026-W45", p_delete: false, p_avatar: "penguin",
  });
  assert.equal(toPayload(profile, { ...settings, avatar: "<script>" }, false, fri).p_avatar, "bunny");
  assert.equal(toPayload(profile, { name: "M", company: "x.com" }, false, fri).p_avatar, "bunny");
  const stale = toPayload(profile, settings, true, mon);
  assert.equal(stale.p_week, "2026-W46");
  assert.equal(stale.p_week_xp, 0);
  assert.equal(stale.p_delete, true);
});

const dayWith = (id, hour = 11) => {
  for (let k = 0; k < 60; k++) {
    const t = new Date(2026, 10, 9 + k, hour).getTime();
    if (dailyFor(t).includes(id)) return t;
  }
  throw new Error(`no day with ${id}`);
};
const brk = (areas, completed = true) => ({
  scored: true,
  countedReps: 18,
  targetReps: 18,
  scores: Array(18).fill(80),
  moves: areas.map((area, k) => ({ key: `k${k}`, area, completed })),
});
const ids = (r) => r.completed.map((c) => c.id);

check("dailyFor: stable, 2-5 distinct pool ids, varies across a week", () => {
  const a = dailyFor(mon);
  assert.deepEqual(a, dailyFor(mon + H));
  assert.ok(a.length >= 2 && a.length <= 5);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.every((id) => DAILY_POOL.some((c) => c.id === id)));
  const seen = new Set(Array.from({ length: 7 }, (_, k) => dailyFor(mon + k * DAY).join()));
  assert.ok(seen.size > 1);
});

check("variety completes on the 3rd distinct area, only once", () => {
  const t = dayWith("variety");
  let p = blankProfile();
  let r = updateChallenges(p, brk(["Neck", "Shoulders"]), 80, t);
  assert.ok(!ids(r).includes("variety"));
  r = updateChallenges(r.profile, brk(["Neck", "Arms & wrists"]), 80, t + M);
  assert.ok(ids(r).includes("variety"));
  assert.ok(r.newBadges.includes("daily:variety"));
  r = updateChallenges(r.profile, brk(["Lower back & core"]), 80, t + 2 * M);
  assert.ok(!ids(r).includes("variety"));
});

check("no_excuses resets after a skip", () => {
  const t = dayWith("no_excuses");
  let r = updateChallenges(blankProfile(), brk(["Neck"]), 80, t);
  r = updateChallenges(r.profile, brk(["Neck"]), 80, t + M);
  let p = noteAction(r.profile, "skip", t + 2 * M);
  r = updateChallenges(p, brk(["Neck"]), 80, t + 3 * M);
  assert.ok(!ids(r).includes("no_excuses"));
  r = updateChallenges(r.profile, brk(["Neck"]), 80, t + 4 * M);
  r = updateChallenges(r.profile, brk(["Neck"]), 80, t + 5 * M);
  assert.ok(ids(r).includes("no_excuses"));
});

check("early_mover before 10:00 only", () => {
  const t = dayWith("early_mover", 9);
  const at959 = new Date(t).setHours(9, 59);
  const at1000 = new Date(t).setHours(10, 0);
  assert.ok(ids(updateChallenges(blankProfile(), brk(["Neck"]), 80, at959)).includes("early_mover"));
  assert.ok(!ids(updateChallenges(blankProfile(), brk(["Neck"]), 80, at1000)).includes("early_mover"));
});

check("clean_form at 90 yes, 89 no", () => {
  const t = dayWith("clean_form");
  assert.ok(ids(updateChallenges(blankProfile(), brk(["Neck"]), 90, t)).includes("clean_form"));
  assert.ok(!ids(updateChallenges(blankProfile(), brk(["Neck"]), 89, t)).includes("clean_form"));
});

check("weekly featured area completes at 10 moves with +100 and badge, resets next week", () => {
  const area = featuredArea(mon);
  let r = updateChallenges(blankProfile(), brk(Array(9).fill(area)), 80, mon);
  assert.equal(r.profile.weekly.count, 9);
  r = updateChallenges(r.profile, brk([area, "Neck"]), 80, mon + M);
  const weekly = r.completed.find((c) => c.id === "weekly");
  assert.equal(weekly.bonus, WEEKLY.bonus);
  assert.ok(r.newBadges.includes(`weekly:${area}`));
  const next = updateChallenges(r.profile, brk(["Neck"], false), 80, mon + 7 * DAY);
  assert.equal(next.profile.weekly.count, 0);
  assert.equal(next.profile.weekly.area, featuredArea(mon + 7 * DAY));
});

check("award total includes challenge bonuses", () => {
  const t = dayWith("clean_form");
  const { breakdown } = award(blankProfile(), { ...full(), scores: Array(18).fill(95) }, t, WORKDAYS);
  const bonus = breakdown.challenges.reduce((n, c) => n + c.bonus, 0);
  assert.ok(breakdown.challenges.some((c) => c.id === "clean_form"));
  assert.equal(breakdown.total, breakdown.breakXp + breakdown.firstBreak + breakdown.streak + bonus);
});

const HOURS = { activeStart: "09:00", activeEnd: "17:00", workdays: WORKDAYS, autoPause: true };
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const sched = (nextAt, extra = {}) => ({ ...initialSchedule(0, 60), nextAt, skipsInRow: 2, snoozesInRow: 1, ...extra });
const ctx = (extra = {}) => ({ idle: "active", meeting: false, settings: HOURS, ...extra });

check("nextActiveSlot: inside stays, after hours jumps to next workday start + interval", () => {
  assert.equal(nextActiveSlot(at(9, 11), 60, HOURS), at(9, 11));
  assert.equal(nextActiveSlot(at(13, 17, 30), 60, HOURS), at(16, 10));
  assert.equal(nextActiveSlot(at(14, 11), 60, HOURS), at(16, 10));
  assert.equal(nextActiveSlot(at(9, 7), 60, HOURS), at(9, 10));
  assert.equal(isActive(at(9, 16, 59), HOURS), true);
  assert.equal(isActive(at(9, 17), HOURS), false);
});

check("decideFire: weekend is outside, rescheduled to Monday", () => {
  const r = decideFire(sched(at(14, 11)), at(14, 11), 60, ctx());
  assert.equal(r.kind, "outside");
  assert.equal(r.schedule.nextAt, at(16, 10));
});

check("decideFire: alarm 11 min late is dropped, counters unchanged", () => {
  const r = decideFire(sched(at(9, 11)), at(9, 11, 11), 60, ctx());
  assert.equal(r.kind, "late");
  assert.equal(r.schedule.nextAt, at(9, 12, 11));
  assert.deepEqual([r.schedule.skipsInRow, r.schedule.snoozesInRow], [2, 1]);
});

check("decideFire: meeting defers 5 min, keeps deferring, never late", () => {
  const r1 = decideFire(sched(at(9, 11)), at(9, 11), 60, ctx({ meeting: true }));
  assert.equal(r1.kind, "defer");
  assert.equal(r1.schedule.nextAt, at(9, 11, 5));
  const r2 = decideFire(r1.schedule, at(9, 11, 40), 60, ctx({ meeting: true }));
  assert.equal(r2.kind, "defer");
  assert.equal(r2.schedule.nextAt, at(9, 11, 45));
  assert.deepEqual([r2.schedule.skipsInRow, r2.schedule.snoozesInRow], [2, 1]);
});

check("decideFire: meeting clears 70 min after slot, opens once, grid not stacked", () => {
  const r1 = decideFire(sched(at(9, 11)), at(9, 11), 60, ctx({ meeting: true }));
  const r2 = decideFire({ ...r1.schedule, nextAt: at(9, 12, 10) }, at(9, 12, 10), 60, ctx());
  assert.equal(r2.kind, "open");
  assert.equal(r2.schedule.nextAt, at(9, 13));
  assert.equal(r2.schedule.deferredFrom, null);
});

check("decideFire: meeting ignored when auto-pause is off", () => {
  const r = decideFire(sched(at(9, 11)), at(9, 11), 60, ctx({ meeting: true, settings: { ...HOURS, autoPause: false } }));
  assert.equal(r.kind, "open");
});

check("decideFire: idle user is away, grid advances, no counter change", () => {
  const r = decideFire(sched(at(9, 11)), at(9, 11), 60, ctx({ idle: "idle" }));
  assert.equal(r.kind, "away");
  assert.equal(r.schedule.nextAt, at(9, 12));
  assert.deepEqual([r.schedule.skipsInRow, r.schedule.snoozesInRow], [2, 1]);
});

check("decideFire: normal fire opens and keeps grid", () => {
  const r = decideFire(sched(at(9, 11)), at(9, 11) + 30_000, 60, ctx());
  assert.equal(r.kind, "open");
  assert.equal(r.schedule.nextAt, at(9, 12));
});

check("decideFire: last slot of the day rolls to next morning", () => {
  const r = decideFire(sched(at(13, 16, 30)), at(13, 16, 30), 60, ctx());
  assert.equal(r.kind, "open");
  assert.equal(r.schedule.nextAt, at(16, 10));
});

check("award: a weekend break does not reset the streak on Monday", () => {
  const sat = new Date(2026, 10, 7, 11).getTime();
  const p0 = { ...blankProfile(), streak: 3, lastStreakDay: dayKey(fri) };
  const afterSat = award(p0, full(), sat, WORKDAYS).profile;
  assert.equal(award(afterSat, full(), mon, WORKDAYS).profile.streak, afterSat.streak + 1);
});

check("scheduleSettingsChanged: interval, hours or workdays changes; blur or mode does not", () => {
  const base = { intervalMin: 60, activeStart: "09:00", activeEnd: "17:00", workdays: [1, 2, 3, 4, 5], privacy: true, mode: "personal" };
  assert.equal(scheduleSettingsChanged(base, { ...base }), false);
  assert.equal(scheduleSettingsChanged(base, { ...base, privacy: false, mode: "competitive" }), false);
  assert.equal(scheduleSettingsChanged(base, { ...base, workdays: [6] }), true);
  assert.equal(scheduleSettingsChanged(base, { ...base, activeStart: "12:17" }), true);
  assert.equal(scheduleSettingsChanged(base, { ...base, activeEnd: "18:00" }), true);
  assert.equal(scheduleSettingsChanged(base, { ...base, intervalMin: 30 }), true);
  assert.equal(scheduleSettingsChanged(base, { ...base, workdays: [5, 4, 3, 2, 1] }), false);
});

check("changing workdays to today reschedules from now, not from the old Monday slot", () => {
  const sat = at(7, 12, 18);
  const satOnly = { activeStart: "12:17", activeEnd: "17:00", workdays: [6] };
  const s = rescheduleForInterval(sched(at(9, 10)), sat, 60);
  assert.equal(nextActiveSlot(s.nextAt, 60, satOnly), at(7, 13, 18));
});

check("themes: seven pickable themes, auto first, unknown ids fall back to auto", () => {
  assert.deepEqual(THEMES.map((t) => t.id), ["auto", "midnight", "daylight", "sunrise", "ocean", "forest", "neon"]);
  assert.ok(THEMES.every((t) => t.name && t.swatch.length === 3));
  assert.equal(themeId("ocean"), "ocean");
  assert.equal(themeId("nope"), "auto");
  assert.equal(themeId(undefined), "auto");
});

check("fresh schedule without counters can snooze and shows no warning", () => {
  assert.equal(canSnooze({ windowId: null, lastKey: null, breakCount: 0 }), true);
  assert.equal(showWarning({ windowId: null, lastKey: null, breakCount: 0 }), false);
});

check("activity: shade levels 0, 1-2, 3-4, 5-6, 7+", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 12].map(activityLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

check("activity: recording a break adds to today, keeps input, drops days older than a year", () => {
  const old = { "2025-10-01": { breaks: 2, xp: 20 } };
  const a1 = recordActivity(old, mon, 12);
  const a2 = recordActivity(a1, mon + H, 8);
  assert.deepEqual(a2["2026-11-09"], { breaks: 2, xp: 20 });
  assert.equal("2025-10-01" in a2, false);
  assert.deepEqual(Object.keys(old), ["2025-10-01"]);
});

check("activity: backfill groups the break log by day", () => {
  const log = [{ at: fri, xp: 10 }, { at: fri + H, xp: 15 }, { at: mon, xp: 0 }, { at: mon + H }];
  assert.deepEqual(backfillActivity(log), {
    "2026-11-06": { breaks: 2, xp: 25 },
    "2026-11-09": { breaks: 2, xp: 0 },
  });
});

check("activity: heatmap is weeks of Mon-Sun cells ending this week, future cells flagged", () => {
  const wed = new Date(2026, 10, 11, 15).getTime();
  const weeks = heatmapWeeks({ "2026-11-09": { breaks: 4, xp: 38 } }, wed, 20, WORKDAYS);
  assert.equal(weeks.length, 20);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(new Date(weeks[0][0].at).getDay(), 1);
  const last = weeks[19];
  assert.equal(last[0].day, "2026-11-09");
  assert.deepEqual([last[0].breaks, last[0].xp, last[0].level], [4, 38, 2]);
  assert.equal(last[2].future, false);
  assert.equal(last[3].future, true);
  assert.equal(last[5].offday, true);
  assert.equal(last[0].offday, false);
});

check("activity: totals over the visible weeks", () => {
  const wed = new Date(2026, 10, 11, 15).getTime();
  const a = { "2026-11-09": { breaks: 4, xp: 38 }, "2026-11-10": { breaks: 1, xp: 9 }, "2025-01-01": { breaks: 9, xp: 90 } };
  assert.deepEqual(activityTotals(a, wed, 20), { breaks: 5, xp: 47, activeDays: 2 });
});

check("nextOpenMove: next unfinished exercise after the current one, wrapping, -1 when all done", () => {
  const moves = [{ target: 6 }, { target: 6 }, { target: 6 }];
  const prog = (...reps) => reps.map((r) => ({ reps: r }));
  assert.equal(nextOpenMove(moves, prog(6, 0, 0), 0), 1);
  assert.equal(nextOpenMove(moves, prog(0, 6, 6), 2), 0);
  assert.equal(nextOpenMove(moves, prog(6, 3, 6), 2), 1);
  assert.equal(nextOpenMove(moves, prog(6, 6, 6), 1), -1);
});

check("swapMove cycles through every exercise in the area, skipping ones used elsewhere", () => {
  const byKey = (k) => CATALOG.find((e) => e.key === k);
  const move = (k) => ({ key: k, label: k, area: byKey(k).category, camera: byKey(k).camera, how_to: "", demo: null, target: BREAK_REPS });
  const cycle = (moves, i, n) => {
    const seen = [];
    let ms = moves;
    for (let s = 0; s < n; s++) {
      const next = swapMove(CATALOG, ms, i);
      seen.push(next.key);
      ms = ms.map((m, k) => (k === i ? next : m));
    }
    return seen;
  };
  assert.deepEqual(cycle([move("air_curl"), move("neck_tilt"), move("t_raise")], 0, 4), ["triceps_reach", "chair_dip", "wrist_flex", "air_curl"]);
  assert.deepEqual(cycle([move("air_curl"), move("chair_dip"), move("t_raise")], 0, 3), ["triceps_reach", "wrist_flex", "air_curl"]);
});

const CAL_NOW = Date.UTC(2026, 10, 9, 10, 0);

check("calendar: auth URL asks Google for free/busy only", () => {
  const url = new URL(buildAuthUrl("cid.apps.googleusercontent.com", "https://abc.chromiumapp.org/", true));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.equal(url.searchParams.get("redirect_uri"), "https://abc.chromiumapp.org/");
  assert.equal(url.searchParams.get("scope"), CALENDAR_SCOPE);
  assert.equal(CALENDAR_SCOPE, "https://www.googleapis.com/auth/calendar.freebusy");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(new URL(buildAuthUrl("c", "https://r/", false)).searchParams.get("prompt"), "none");
});

check("calendar: parses the token from the redirect, rejects errors", () => {
  const ok = parseAuthResponse("https://abc.chromiumapp.org/#access_token=ya29.x&token_type=Bearer&expires_in=3599&scope=s", CAL_NOW);
  assert.deepEqual(ok, { token: "ya29.x", expiresAt: CAL_NOW + 3599 * 1000 });
  assert.equal(parseAuthResponse("https://abc.chromiumapp.org/#error=access_denied", CAL_NOW), null);
  assert.equal(parseAuthResponse("https://abc.chromiumapp.org/", CAL_NOW), null);
});

check("calendar: busy blocks parsed and sorted from the free/busy response", () => {
  const body = { calendars: { primary: { busy: [
    { start: "2026-11-09T12:00:00Z", end: "2026-11-09T12:30:00Z" },
    { start: "2026-11-09T09:45:00Z", end: "2026-11-09T10:20:00Z" },
  ] } } };
  assert.deepEqual(parseBusy(body), [
    { start: Date.UTC(2026, 10, 9, 9, 45), end: Date.UTC(2026, 10, 9, 10, 20) },
    { start: Date.UTC(2026, 10, 9, 12, 0), end: Date.UTC(2026, 10, 9, 12, 30) },
  ]);
  assert.deepEqual(parseBusy({}), []);
});

check("calendar: in a meeting now, and the next meeting after now", () => {
  const busy = [{ start: CAL_NOW - 15 * M, end: CAL_NOW + 20 * M }, { start: CAL_NOW + 2 * 60 * M, end: CAL_NOW + 150 * M }];
  assert.deepEqual(busyNow(busy, CAL_NOW), busy[0]);
  assert.equal(busyNow(busy, CAL_NOW + 30 * M), null);
  assert.deepEqual(nextMeeting(busy, CAL_NOW), busy[1]);
  assert.equal(nextMeeting(busy, CAL_NOW + 3 * 60 * M), null);
});

check("dailyFor: the number of challenges changes from day to day within 2-5", () => {
  const counts = new Set(Array.from({ length: 60 }, (_, k) => dailyFor(mon + k * DAY).length));
  assert.ok([...counts].every((n) => n >= 2 && n <= 5));
  assert.ok(counts.size >= 3);
});

const pending = [];
check("leaderboard unconfigured resolves null/false without throwing", () => {
  pending.push(
    fetchBoard("x.com", "week", "id", { url: "", key: "" }).then((r) => assert.equal(r, null)),
    submitScore(blankProfile(), { mode: "competitive", name: "a", company: "x.com" }, { remove: false }, { url: "", key: "" }).then((r) => assert.equal(r, false)),
  );
});
const log = [];
const serial = createSerial();
const step = (name, ms) => async () => {
  log.push(`${name}:start`);
  await new Promise((r) => setTimeout(r, ms));
  log.push(`${name}:end`);
};
pending.push(
  Promise.all([serial(step("a", 30)), serial(step("b", 1)), serial(async () => { throw new Error("boom"); }).catch(() => "caught"), serial(step("c", 1))]).then(
    ([, , caught]) => {
      assert.deepEqual(log, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
      assert.equal(caught, "caught");
    },
  ),
);
check("i18n: t() translates, interpolates and falls back to English then the key", () => {
  assert.equal(t("en", "nextAt", { time: "10:30", n: 5 }), "Next break at 10:30 · in 5 min");
  assert.equal(t("ar", "nextAt", { time: "10:30", n: 5 }), "الاستراحة القادمة 10:30 · بعد 5 دقيقة");
  assert.equal(t("ar", "exerciseStep", { i: 1, n: 3 }), "التمرين 1 من 3");
  assert.equal(t("en", "level", { n: 2 }), "Lv 2 · {name}");
  assert.equal(t("xx", "done"), "Done");
  assert.equal(t("ar", "no.such.key"), "no.such.key");
});
check("i18n: every English string has an Arabic translation", () => {
  const ar = new Set(translationKeys("ar"));
  const missing = translationKeys("en").filter((k) => !ar.has(k));
  assert.deepEqual(missing, []);
  assert.deepEqual(translationKeys("en").filter((k) => t("ar", k) === t("en", k)), ["xpOf"]);
});
check("i18n: all exercises, areas, levels, daily challenges and office rep tips translated", () => {
  for (const key of CATALOG.map((e) => e.key)) {
    assert.notEqual(exerciseText("ar", key, "label", "EN"), "EN", key);
    assert.notEqual(exerciseText("ar", key, "how_to", "EN"), "EN", key);
    assert.equal(exerciseText("en", key, "label", "EN"), "EN");
  }
  assert.equal(CATALOG.length, 30);
  for (const a of AREAS) {
    assert.notEqual(areaName("ar", a), a);
    assert.equal(areaName("en", a), a);
  }
  for (const lv of LEVELS) {
    assert.notEqual(levelName("ar", lv.level, lv.name), lv.name);
    assert.equal(levelName("en", lv.level, lv.name), lv.name);
  }
  for (const c of DAILY_POOL) {
    assert.notEqual(nameText("ar", `challenge.${c.id}`, c.name), c.name);
    assert.equal(badgeLabel(`daily:${c.id}`), badgeLabel(`daily:${c.id}`, "en"));
  }
  for (const th of THEMES) assert.notEqual(nameText("ar", `theme.${th.id}`, th.name), th.name);
  for (const code of ["not_visible", "not_deep_enough", "too_fast"]) assert.notEqual(issueText("ar", code, "EN"), "EN");
  assert.equal(issueText("ar", "unknown_code", "Fallback"), "Fallback");
  assert.equal(issueText("en", "too_fast", "Slow down"), "Slow down");
  assert.equal(badgeLabel("weekly:Neck"), "🏅 Neck week");
  assert.equal(badgeLabel("weekly:Neck", "ar"), "🏅 أسبوع الرقبة");
});
check("i18n: resolveLang and localeFor", () => {
  assert.deepEqual(LANGS, ["auto", "en", "ar"]);
  assert.equal(resolveLang("ar", "en-US"), "ar");
  assert.equal(resolveLang("en", "ar-EG"), "en");
  assert.equal(resolveLang("auto", "ar-EG"), "ar");
  assert.equal(resolveLang("auto", "AR"), "ar");
  assert.equal(resolveLang("auto", "en-GB"), "en");
  assert.equal(resolveLang(undefined, undefined), "en");
  assert.equal(resolveLang("fr", "de"), "en");
  assert.equal(localeFor("ar"), "ar-u-nu-latn");
  assert.equal(localeFor("en"), undefined);
  assert.equal(new Date(2026, 10, 9, 10, 5).toLocaleTimeString(localeFor("ar"), { hour: "2-digit", minute: "2-digit" }).replace(/[^0-9:]/g, ""), "10:05");
});
Promise.all(pending).then(
  () => console.log("ok leaderboard async checks"),
  (err) => {
    console.log(`FAIL leaderboard async checks\n  ${err.message}`);
    process.exitCode = 1;
  },
);
