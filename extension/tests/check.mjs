import assert from "node:assert/strict";
import { LEVELS, levelFor, breakXp, award, dayKey, isoWeek } from "../lib/xp.js";
import { AREAS, BREAK_REPS, buildRoutine, swapMove, needsPositioning, featuredArea, nextOpenMove, currentAreas } from "../lib/routine.js";
import {
  SNOOZE_CAP, initialSchedule, onFire, applyAction, canSnooze, showWarning, warningHours, upcoming, rescheduleForInterval,
  nextActiveSlot, decideFire, isActive, scheduleSettingsChanged, weekOrder, countdownText,
} from "../lib/schedule.js";
import { toPayload, fetchBoard, submitScore } from "../lib/leaderboard.js";
import { requestSession } from "../lib/session.js";
import { API_URL } from "../config.js";
import { DAILY_POOL, WEEKLY, dailyFor, updateChallenges, noteAction, withPeriods } from "../lib/challenges.js";
import { createSerial } from "../lib/serial.js";
import { THEMES, themeId } from "../lib/themes.js";
import { activityLevel, recordActivity, backfillActivity, heatmapWeeks, activityTotals } from "../lib/activity.js";
import { avatarFitness, missedWorkdays, fitnessCaption } from "../lib/fitness.js";
import { LANGS, resolveLang, t, exerciseText, areaName, levelName, issueText, localeFor, nameText, translationKeys } from "../lib/i18n.js";
import { badgeLabel } from "../lib/badges.js";
import { CALENDAR_SCOPE, buildAuthUrl, parseAuthResponse, busyNow, nextMeeting, parseBusy, agenda } from "../lib/calendar.js";
import { PERSONAL_DOMAINS, companyFromEmail, buildSignInUrl, parseSignInResponse, newNonce, sha256Hex, toSession } from "../lib/auth.js";
import { MEMES, memeFile, takeTurn, repMarks, createMemePlayer } from "../lib/memes.js";
import { readFileSync, readdirSync } from "node:fs";

/** @typedef {import("../lib/vendor/three.js").Mesh} Mesh  what the avatar scene traversals below look at */

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

// Mirrors the server catalog (server/src/analysis/exercises.ts): five exercises per pain area.
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
const SIDE_ON = new Set(["chin_tuck", "thoracic_extension", "clasp_opener", "seated_row", "desk_punch", "rhomboid_stretch", "desk_row",
  "front_raise", "knee_to_chest", "hip_hinge", "back_extension", "wrist_flex", "extensor_stretch", "flexor_stretch", "seated_knee_ext",
  "heel_slide", "sit_to_stand", "mini_squat", "hamstring_curl", "near_far_focus", "eye_track_vertical"]);
const STANDING = new Set(["clasp_opener", "desk_row", "hip_hinge", "standing_side_bend", "back_extension", "sit_to_stand", "mini_squat", "hamstring_curl"]);
const CATALOG = Object.entries(AREA_KEYS).flatMap(([category, keys]) =>
  keys.map((key) => ({
    key,
    label: key,
    category,
    camera: SIDE_ON.has(key) ? "side" : "front",
    stance: STANDING.has(key) ? "standing" : "seated",
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
  moves: [{ key: "neck_tilt", area: "Neck tension", completed: true }],
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

check("routine: only the areas the user selected, no dupes", () => {
  const moves = buildRoutine(CATALOG, { areas: ["Neck tension", "Shoulder & rotator cuff"], lastKey: null, n: 0 });
  assert.equal(moves.length, 3);
  assert.equal(new Set(moves.map((m) => m.key)).size, 3);
  assert.ok(moves.every((m) => ["Neck tension", "Shoulder & rotator cuff"].includes(m.area)));
  assert.ok(moves.every((m) => m.target === BREAK_REPS && m.how_to && m.label));
  for (let n = 0; n < 8; n++) {
    const single = buildRoutine(CATALOG, { areas: ["Knees"], lastKey: null, n });
    assert.ok(single.every((m) => m.area === "Knees"), `n=${n}`);
  }
});

check("routine: avoids lastKey in slot 1", () => {
  const opts = { areas: ["Neck tension"], lastKey: null, n: 0 };
  const first = buildRoutine(CATALOG, opts)[0].key;
  assert.notEqual(buildRoutine(CATALOG, { ...opts, lastKey: first })[0].key, first);
});

check("routine: all slots from user areas when featured is one of them", () => {
  const moves = buildRoutine(CATALOG, { areas: ["Neck tension", "Shoulder & rotator cuff"], lastKey: null, n: 1 });
  assert.equal(moves.length, 3);
  assert.ok(moves.every((m) => ["Neck tension", "Shoulder & rotator cuff"].includes(m.area)));
});

check("swapMove returns same-area exercise not already in routine; null when area exhausted", () => {
  const moves = buildRoutine(CATALOG, { areas: ["Neck tension", "Shoulder & rotator cuff"], lastKey: null, n: 0 });
  const i = moves.findIndex((m) => m.area === "Shoulder & rotator cuff");
  const swapped = swapMove(CATALOG, moves, i);
  assert.equal(swapped.area, "Shoulder & rotator cuff");
  assert.ok(!moves.some((m) => m.key === swapped.key));
  const tiny = CATALOG.filter((e) => ["neck_tilt", "head_turn"].includes(e.key));
  const neck = buildRoutine(tiny, { areas: ["Neck tension"], lastKey: null, n: 0 });
  assert.equal(neck.length, 2);
  assert.equal(swapMove(tiny, neck, 0), null);
});

check("needsPositioning", () => {
  const byKey = (k) => {
    const only = CATALOG.filter((e) => e.key === k);
    return buildRoutine(only, { areas: [only[0].category], lastKey: null, n: 0 })[0];
  };
  assert.equal(needsPositioning(byKey("sit_to_stand")), true); // side-on
  assert.equal(needsPositioning(byKey("standing_side_bend")), true); // front, but standing
  assert.equal(needsPositioning(byKey("neck_tilt")), false);
  assert.equal(needsPositioning(byKey("palming")), false);
  assert.equal(needsPositioning({ camera: "front", area: "Knees" }), false); // catalog cached before stance existed
});

check("featuredArea rotates weekly over every area except the opt-in Eyes", () => {
  assert.ok(AREAS.includes(featuredArea(mon)));
  assert.notEqual(featuredArea(mon), featuredArea(mon + 7 * DAY));
  assert.equal(AREAS.length, 8);
  const featured = new Set(Array.from({ length: 52 }, (_, k) => featuredArea(mon + k * 7 * DAY)));
  assert.deepEqual([...featured].sort(), AREAS.filter((a) => a !== "Eyes").sort());
});

check("every area has five catalog exercises", () => {
  assert.deepEqual(Object.keys(AREA_KEYS), AREAS);
  for (const a of AREAS) assert.equal(CATALOG.filter((e) => e.category === a).length, 5, a);
});

check("currentAreas maps saved pre-update area names onto the pain areas", () => {
  assert.deepEqual(currentAreas(["Neck", "Arms & wrists"]), ["Neck tension", "Wrist & hand"]);
  assert.deepEqual(currentAreas(["Upper back & posture"]), ["Rounded shoulders", "Upper back"]);
  assert.deepEqual(currentAreas(["Hips & glutes", "Legs & circulation", "Knees"]), ["Lower back", "Knees"]);
  assert.deepEqual(currentAreas(["Eyes", "Neck tension", "Gone"]), ["Neck tension", "Eyes"]);
  assert.deepEqual(currentAreas(undefined), []);
});

check("this week's challenge on a pre-update area name moves to the featured area, keeping progress", () => {
  const p = { ...blankProfile(), weekly: { week: isoWeek(mon), area: "Neck", count: 4, done: false } };
  assert.deepEqual(withPeriods(p, mon).weekly, { week: isoWeek(mon), area: featuredArea(mon), count: 4, done: false });
  assert.equal(p.weekly.area, "Neck");
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

check("leaderboard payload maps fields without id, secret or company, zeroes stale week", () => {
  const profile = { ...blankProfile(), playerId: "id1", secret: "sec", xp: 260, streak: 4, weekXp: 40, week: "2026-W45" };
  const settings = { name: "Malik", avatar: "penguin" };
  assert.deepEqual(toPayload(profile, settings, fri), {
    name: "Malik", xp: 260, level: 3, streak: 4, weekXp: 40, week: "2026-W45", avatar: "penguin",
  });
  assert.equal(toPayload(profile, { ...settings, avatar: "<script>" }, fri).avatar, "bunny");
  assert.equal(toPayload(profile, { name: "M" }, fri).avatar, "bunny");
  const stale = toPayload(profile, settings, mon);
  assert.equal(stale.week, "2026-W46");
  assert.equal(stale.weekXp, 0);
});

check("leaderboard API is the hosted pose server, and the manifest CSP lets pages reach it", () => {
  assert.equal(API_URL, "https://squat-overflow-pose.fly.dev");
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const connectSrc = manifest.content_security_policy.extension_pages.match(/connect-src([^;]*)/)[1].trim().split(/\s+/);
  assert.ok(connectSrc.includes(new URL(API_URL).origin), "CSP connect-src misses the API origin");
  assert.ok(!connectSrc.some((src) => src.includes("supabase")), "CSP still allows Supabase");
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
  let r = updateChallenges(p, brk(["Neck tension", "Shoulder & rotator cuff"]), 80, t);
  assert.ok(!ids(r).includes("variety"));
  r = updateChallenges(r.profile, brk(["Neck tension", "Wrist & hand"]), 80, t + M);
  assert.ok(ids(r).includes("variety"));
  assert.ok(r.newBadges.includes("daily:variety"));
  r = updateChallenges(r.profile, brk(["Lower back"]), 80, t + 2 * M);
  assert.ok(!ids(r).includes("variety"));
});

check("no_excuses resets after a skip", () => {
  const t = dayWith("no_excuses");
  let r = updateChallenges(blankProfile(), brk(["Neck tension"]), 80, t);
  r = updateChallenges(r.profile, brk(["Neck tension"]), 80, t + M);
  let p = noteAction(r.profile, "skip", t + 2 * M);
  r = updateChallenges(p, brk(["Neck tension"]), 80, t + 3 * M);
  assert.ok(!ids(r).includes("no_excuses"));
  r = updateChallenges(r.profile, brk(["Neck tension"]), 80, t + 4 * M);
  r = updateChallenges(r.profile, brk(["Neck tension"]), 80, t + 5 * M);
  assert.ok(ids(r).includes("no_excuses"));
});

check("early_mover before 10:00 only", () => {
  const t = dayWith("early_mover", 9);
  const at959 = new Date(t).setHours(9, 59);
  const at1000 = new Date(t).setHours(10, 0);
  assert.ok(ids(updateChallenges(blankProfile(), brk(["Neck tension"]), 80, at959)).includes("early_mover"));
  assert.ok(!ids(updateChallenges(blankProfile(), brk(["Neck tension"]), 80, at1000)).includes("early_mover"));
});

check("clean_form at 90 yes, 89 no", () => {
  const t = dayWith("clean_form");
  assert.ok(ids(updateChallenges(blankProfile(), brk(["Neck tension"]), 90, t)).includes("clean_form"));
  assert.ok(!ids(updateChallenges(blankProfile(), brk(["Neck tension"]), 89, t)).includes("clean_form"));
});

check("weekly featured area completes at 10 moves with +100 and badge, resets next week", () => {
  const area = featuredArea(mon);
  let r = updateChallenges(blankProfile(), brk(Array(9).fill(area)), 80, mon);
  assert.equal(r.profile.weekly.count, 9);
  r = updateChallenges(r.profile, brk([area, "Neck tension"]), 80, mon + M);
  const weekly = r.completed.find((c) => c.id === "weekly");
  assert.equal(weekly.bonus, WEEKLY.bonus);
  assert.ok(r.newBadges.includes(`weekly:${area}`));
  const next = updateChallenges(r.profile, brk(["Neck tension"], false), 80, mon + 7 * DAY);
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

check("fitness: buff grows with level, 0 at Desk Potato, 1 at the top level", () => {
  assert.equal(avatarFitness(0, null, mon, WORKDAYS).buff, 0);
  assert.equal(avatarFitness(900, null, mon, WORKDAYS).buff, 4 / 7);
  assert.equal(avatarFitness(99_999, null, mon, WORKDAYS).buff, 1);
});

check("fitness: missed workdays count back from yesterday, skip weekends, stop at the last break", () => {
  const wed = new Date(2026, 10, 11, 15).getTime();
  assert.equal(missedWorkdays({ "2026-11-06": { breaks: 2, xp: 20 } }, wed, WORKDAYS), 2);
  assert.equal(missedWorkdays({ "2026-11-06": { breaks: 2, xp: 20 } }, mon, WORKDAYS), 0);
  assert.equal(missedWorkdays({ "2026-11-10": { breaks: 0, xp: 0 }, "2026-11-06": { breaks: 1, xp: 9 } }, wed, WORKDAYS), 2);
});

check("fitness: a break today perks it straight back up; a new user starts perky", () => {
  const wed = new Date(2026, 10, 11, 15).getTime();
  assert.equal(missedWorkdays({ "2026-11-11": { breaks: 1, xp: 9 }, "2026-10-01": { breaks: 1, xp: 9 } }, wed, WORKDAYS), 0);
  assert.equal(missedWorkdays(null, wed, WORKDAYS), 0);
  assert.equal(missedWorkdays({}, wed, WORKDAYS), 0);
  // Days before the first recorded break don't count against you.
  assert.equal(missedWorkdays({ "2026-11-09": { breaks: 1, xp: 9 } }, new Date(2026, 10, 12, 9).getTime(), WORKDAYS), 2);
});

check("fitness: a full work week without a break is as droopy as it gets", () => {
  const f = avatarFitness(500, { "2026-10-30": { breaks: 3, xp: 30 } }, mon, WORKDAYS);
  assert.equal(f.missed, 5);
  assert.equal(f.droop, 1);
  const longer = avatarFitness(500, { "2026-10-20": { breaks: 3, xp: 30 } }, mon, WORKDAYS);
  assert.equal(longer.droop, 1);
  const two = avatarFitness(500, { "2026-11-04": { breaks: 3, xp: 30 } }, mon, WORKDAYS);
  assert.equal(two.droop, 2 / 5);
});

check("fitness: caption roasts droop first, then brags about buff", () => {
  assert.match(fitnessCaption({ buff: 1, missed: 5 }, "Penguin"), /penguin/i);
  assert.match(fitnessCaption({ buff: 1, missed: 5 }, "Penguin"), /chair/i);
  assert.match(fitnessCaption({ buff: 0, missed: 2 }, "Bunny"), /2 workdays/);
  assert.match(fitnessCaption({ buff: 0, missed: 1 }, "Bunny"), /yesterday/);
  assert.match(fitnessCaption({ buff: 1, missed: 0 }, "Bunny"), /peak/i);
  assert.match(fitnessCaption({ buff: 0, missed: 0 }, "Bunny"), /level up/i);
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
  assert.deepEqual(cycle([move("wrist_flex"), move("neck_tilt"), move("t_raise")], 0, 5), ["extensor_stretch", "flexor_stretch", "prayer_stretch", "nerve_glide", "wrist_flex"]);
  assert.deepEqual(cycle([move("wrist_flex"), move("flexor_stretch"), move("t_raise")], 0, 4), ["extensor_stretch", "prayer_stretch", "nerve_glide", "wrist_flex"]);
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

check("agenda: current meeting, upcoming blocks, break-sized gaps, tomorrow label, ended meetings dropped", () => {
  const t = (h, m = 0, d = 9) => new Date(2026, 10, d, h, m).getTime();
  const now = t(13, 40);
  const busy = [
    { start: t(12, 0), end: t(12, 30) },
    { start: t(13, 30), end: t(14, 0) },
    { start: t(14, 30), end: t(15, 0) },
    { start: t(15, 5), end: t(15, 30) },
    { start: t(10, 0, 10), end: t(11, 0, 10) },
  ];
  assert.deepEqual(agenda(busy, now), [
    { type: "meeting", start: t(13, 30), end: t(14, 0), now: true, tomorrow: false },
    { type: "gap", minutes: 30 },
    { type: "meeting", start: t(14, 30), end: t(15, 0), now: false, tomorrow: false },
    { type: "meeting", start: t(15, 5), end: t(15, 30), now: false, tomorrow: false },
    { type: "meeting", start: t(10, 0, 10), end: t(11, 0, 10), now: false, tomorrow: true },
  ]);
  assert.equal(agenda(busy, now, 2).filter((x) => x.type === "meeting").length, 2);
  assert.deepEqual(agenda([], now), []);
  const later = [{ start: now + 23 * 60 * M, end: now + 27 * 60 * M }, { start: now + 25 * 60 * M, end: now + 26 * 60 * M }];
  assert.deepEqual(agenda(later, now).map((x) => x.end), [now + 27 * 60 * M]);
});

check("weekOrder: seven days starting from the chosen first day", () => {
  assert.deepEqual(weekOrder(6), [6, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(weekOrder(0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(weekOrder(1), [1, 2, 3, 4, 5, 6, 0]);
});

check("auth: company comes from a work email domain, personal and invalid emails get none", () => {
  assert.equal(companyFromEmail("malik@leadliaison.com"), "leadliaison.com");
  assert.equal(companyFromEmail("Malik@LeadLiaison.COM"), "leadliaison.com");
  assert.equal(companyFromEmail("someone@gmail.com"), null);
  assert.equal(companyFromEmail("Someone@GMAIL.com"), null);
  for (const d of PERSONAL_DOMAINS) assert.equal(companyFromEmail(`a@${d}`), null, d);
  assert.equal(PERSONAL_DOMAINS.length, 16);
  for (const bad of ["", "nobody", "@leadliaison.com", "a@", null, undefined]) assert.equal(companyFromEmail(bad), null, String(bad));
});

check("auth: sign-in URL asks Google for an id token with the hashed nonce, calendar only when asked", () => {
  const url = new URL(buildSignInUrl("cid.apps.googleusercontent.com", "https://abc.chromiumapp.org/", "hashed123", false));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("response_type"), "id_token token");
  assert.equal(url.searchParams.get("redirect_uri"), "https://abc.chromiumapp.org/");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("nonce"), "hashed123");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  const withCal = new URL(buildSignInUrl("c", "https://r/", "n", true));
  assert.equal(withCal.searchParams.get("scope"), `openid email profile ${CALENDAR_SCOPE}`);
});

check("auth: parses id and access tokens from the redirect, rejects errors and missing tokens", () => {
  const ok = parseSignInResponse("https://abc.chromiumapp.org/#access_token=ya29.x&id_token=eyJ.a.b&token_type=Bearer&expires_in=3599", CAL_NOW);
  assert.deepEqual(ok, { idToken: "eyJ.a.b", accessToken: "ya29.x", expiresAt: CAL_NOW + 3599 * 1000 });
  assert.equal(parseSignInResponse("https://abc.chromiumapp.org/#error=access_denied", CAL_NOW), null);
  assert.equal(parseSignInResponse("https://abc.chromiumapp.org/#access_token=ya29.x&expires_in=3599", CAL_NOW), null);
  assert.equal(parseSignInResponse("https://abc.chromiumapp.org/", CAL_NOW), null);
});

check("auth: the token response maps to the stored session", () => {
  const body = {
    access_token: "jwt", refresh_token: "r1", expires_in: 3600,
    user: { id: "u1", email: "malik@leadliaison.com", user_metadata: { full_name: "Malik Hesham", avatar_url: "https://pic" } },
  };
  assert.deepEqual(toSession(body, CAL_NOW), {
    accessToken: "jwt", refreshToken: "r1", expiresAt: CAL_NOW + 3600 * 1000,
    user: { id: "u1", email: "malik@leadliaison.com", name: "Malik Hesham", picture: "https://pic" },
  });
  assert.equal(toSession({ ...body, user: { id: "u1", email: "e@x.com" } }, CAL_NOW).user.name, "");
});

check("countdownText: seconds in the last minute, minutes below 100, hours above, move at zero", () => {
  assert.equal(countdownText(45_000), "45s");
  assert.equal(countdownText(59_400), "60s");
  assert.equal(countdownText(60_000), "1m");
  assert.equal(countdownText(61_000), "2m");
  assert.equal(countdownText(99 * 60_000), "99m");
  assert.equal(countdownText(150 * 60_000), "3h");
  assert.equal(countdownText(0), "move");
  assert.equal(countdownText(-5_000), "move");
});

const pending = [];
check("auth: Google gets the SHA-256 hex of a fresh random nonce", () => {
  const a = newNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, newNonce());
  pending.push(sha256Hex("abc").then((h) => assert.equal(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")));
});
check("leaderboard unconfigured resolves null/false without throwing", () => {
  pending.push(
    fetchBoard("week", { url: "", session: async () => ({ accessToken: "t" }) }).then((r) => assert.equal(r, null)),
    submitScore(blankProfile(), { mode: "competitive", name: "a" }, { remove: false }, { url: "", session: async () => ({ accessToken: "t" }) }).then((r) => assert.equal(r, false)),
  );
});
check("leaderboard signed out resolves null/false without calling the server", () => {
  const cfg = { url: "https://api.test", session: async () => null };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("fetch called while signed out"));
  pending.push(
    Promise.all([
      fetchBoard("week", cfg).then((r) => assert.equal(r, null)),
      submitScore(blankProfile(), { mode: "competitive", name: "a" }, { remove: false }, cfg).then((r) => assert.equal(r, false)),
      submitScore(blankProfile(), { mode: "competitive", name: "a" }, { remove: true }, cfg).then((r) => assert.equal(r, false)),
    ]).finally(() => (globalThis.fetch = realFetch)),
  );
});
/** Swaps globalThis.fetch for one call: records the request, answers with `status` and `json`. */
function fakeFetch(status, json) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return new Response(status === 204 ? null : JSON.stringify(json), { status });
  };
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}
const serially = (() => { let chain = Promise.resolve(); return (fn) => (chain = chain.then(fn, fn)); })();
const signedIn = { url: "https://api.test", session: async () => ({ accessToken: "tok" }) };
const competitor = { mode: "competitive", name: "Malik", avatar: "penguin" };
check("leaderboard submit PUTs my score with the bearer token; leaving DELETEs it", () => {
  pending.push(serially(async () => {
    const put = fakeFetch(204);
    try {
      assert.equal(await submitScore({ ...blankProfile(), xp: 260 }, competitor, {}, signedIn), true);
    } finally { put.restore(); }
    assert.equal(put.calls.length, 1);
    assert.equal(put.calls[0].url, "https://api.test/leaderboard/me");
    assert.equal(put.calls[0].method, "PUT");
    assert.equal(put.calls[0].headers.Authorization, "Bearer tok");
    assert.equal(put.calls[0].body.name, "Malik");
    assert.equal(put.calls[0].body.xp, 260);

    const del = fakeFetch(204);
    try {
      assert.equal(await submitScore(blankProfile(), { mode: "casual" }, { remove: true }, signedIn), true);
    } finally { del.restore(); }
    assert.deepEqual([del.calls[0].url, del.calls[0].method, del.calls[0].body], ["https://api.test/leaderboard/me", "DELETE", undefined]);

    const down = fakeFetch(503, { message: "leaderboard not configured" });
    try {
      assert.equal(await submitScore(blankProfile(), competitor, {}, signedIn), false);
    } finally { down.restore(); }
  }));
});
check("leaderboard board GETs the period with the bearer token; errors resolve null", () => {
  pending.push(serially(async () => {
    const rows = [{ rank: 1, name: "Malik", level: 3, xp: 260, streak: 4, is_me: true, avatar: "penguin", company: "leadliaison.com" }];
    const ok = fakeFetch(200, rows);
    try {
      assert.deepEqual(await fetchBoard("week", signedIn), rows);
    } finally { ok.restore(); }
    assert.deepEqual([ok.calls[0].url, ok.calls[0].method, ok.calls[0].headers.Authorization], ["https://api.test/leaderboard?period=week", "GET", "Bearer tok"]);
    const bad = fakeFetch(401, { message: "Unauthorized" });
    try {
      assert.equal(await fetchBoard("all", signedIn), null);
    } finally { bad.restore(); }
  }));
});
check("session: sign-in and refresh POST to the pose server's auth API and map the reply", () => {
  pending.push(serially(async () => {
    const reply = { access_token: "jwt", refresh_token: "r2", expires_in: 3600, user: { id: "u1", email: "malik@leadliaison.com", user_metadata: { full_name: "Malik" } } };
    const ok = fakeFetch(200, reply);
    let session;
    try {
      session = await requestSession("/auth/refresh", { refresh_token: "r1" }, "https://api.test");
    } finally { ok.restore(); }
    assert.deepEqual([ok.calls[0].url, ok.calls[0].method, ok.calls[0].body], ["https://api.test/auth/refresh", "POST", { refresh_token: "r1" }]);
    assert.equal(session.accessToken, "jwt");
    assert.equal(session.user.name, "Malik");
    const bad = fakeFetch(401, { message: "invalid session" });
    try {
      await assert.rejects(requestSession("/auth/refresh", { refresh_token: "spent" }, "https://api.test"), /auth 401/);
    } finally { bad.restore(); }
  }));
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
check("memes: exactly the grouped clips are bundled, each in one group", () => {
  const used = Object.values(MEMES).flat();
  assert.equal(new Set(used).size, used.length, "a clip is in two groups");
  const files = readdirSync(new URL("../sounds/memes/", import.meta.url)).sort();
  assert.deepEqual(files, used.map(memeFile).map((f) => f.split("/").pop()).sort());
  assert.equal(files.length, 24 + 25); // every #label from the meme video, every "Sound N" from the sfx one
  assert.deepEqual(MEMES.start.slice(0, 2), ["meme-04", "meme-01"]);
  assert.deepEqual(MEMES.start.slice(-25, -23), ["sfx-01", "sfx-02"]);
  assert.equal(MEMES.start.at(-1), "sfx-25");
  assert.equal(memeFile("meme-07"), "sounds/memes/meme-07.ogg");
});
check("memes: each group takes turns in order, wrapping round, starting over on bad saved turns", () => {
  const order = (group, turn, n) => Array.from({ length: n }, () => {
    const r = takeTurn(group, turn);
    turn = r.next;
    return r.clip;
  });
  const nums = (list) => list.map((c) => Number(c.split("-")[1]));
  assert.deepEqual(nums(order(MEMES.unscored, 0, 9)), [7, 8, 10, 12, 14, 18, 24, 7, 8]);
  assert.deepEqual(nums(order(MEMES.done, 1, 3)), [9, 5, 9]);
  assert.deepEqual(order(MEMES.start, 12, 3), ["meme-23", "sfx-01", "sfx-02"]);
  assert.deepEqual(order(MEMES.start, MEMES.start.length - 1, 2), ["sfx-25", "meme-04"]);
  for (const bad of [undefined, -1, 1.5, "2"]) assert.equal(takeTurn(MEMES.done, bad).clip, "meme-05");
  assert.equal(takeTurn(MEMES.done, 7).clip, "meme-09"); // a group that shrank since the turn was saved
});
check("memes: rep clips split the break's total reps evenly", () => {
  assert.deepEqual(repMarks(18), [9, 18]);
  assert.deepEqual(repMarks(12), [6, 12]);
  assert.deepEqual(repMarks(15), [8, 15]);
  assert.deepEqual(repMarks(18, 3), [6, 12, 18]);
});
pending.push(
  (async () => {
    const heard = [];
    const saved = [];
    const player = createMemePlayer({ done: 1, unscored: 5 }, (t) => saved.push(t), async (clip) => {
      heard.push(`${clip}:start`);
      await new Promise((r) => setTimeout(r, clip === "meme-16" ? 20 : 1));
      heard.push(`${clip}:end`);
    });
    player.play("reps");
    player.play("reps");
    await player.play("done");
    await player.play("unscored");
    await player.play("unscored");
    // One at a time, in the order asked; turns pick up where earlier breaks left off.
    assert.deepEqual(heard, [
      "meme-06:start", "meme-06:end", "meme-16:start", "meme-16:end", "meme-09:start", "meme-09:end",
      "meme-18:start", "meme-18:end", "meme-24:start", "meme-24:end",
    ]);
    assert.deepEqual(saved.at(-1), { done: 0, unscored: 0, reps: 0 });
  })(),
);
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
  assert.equal(CATALOG.length, 40);
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
  assert.equal(badgeLabel("weekly:Neck tension"), "🏅 Neck tension week");
  assert.equal(badgeLabel("weekly:Neck tension", "ar"), "🏅 أسبوع توتر الرقبة");
  assert.equal(badgeLabel("weekly:Neck", "ar"), "🏅 أسبوع الرقبة"); // badge earned before the pain areas
  for (const a of AREAS) assert.notEqual(t("ar", `areaHint.${a}`), t("en", `areaHint.${a}`), a);
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

// ---- Cross-device sync (lib/sync-core.js, lib/store.js's outbox, lib/sync.js) against an
// in-memory chrome.storage.local and a fake sync server that behaves like server/src/sync.
{
  await Promise.allSettled(pending); // those checks swap globalThis.fetch; don't overlap them
  const acheck = async (name, fn) => {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (err) {
      console.log(`FAIL ${name}\n  ${err.stack ?? err.message}`);
      process.exitCode = 1;
    }
  };
  /** chrome.storage.local over a plain object, with its get() key forms. */
  const fakeLocal = (mem) => {
    const pick = (keys) => {
      if (keys == null) return structuredClone(mem);
      if (typeof keys === "string") return pick([keys]);
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in mem ? structuredClone(mem[k]) : d]));
    };
    return {
      get: async (keys) => pick(keys),
      set: async (o) => void Object.assign(mem, structuredClone(o)),
      remove: async (keys) => [].concat(keys).forEach((k) => delete mem[k]),
    };
  };
  const mem = {};
  const reset = (data = {}) => {
    for (const k of Object.keys(mem)) delete mem[k];
    Object.assign(mem, structuredClone(data));
  };
  const hadChrome = "chrome" in globalThis;
  globalThis.chrome = /** @type {any} */ ({ storage: { local: fakeLocal(mem) } });
  const core = await import("../lib/sync-core.js");
  const store = await import("../lib/store.js");
  const { syncNow } = await import("../lib/sync.js");

  /** The sync API in memory: events with seq, per-field settings merge, last-write-wins progress. */
  const fakeServer = () => {
    /** @type {any} */
    const srv = { events: [], seq: 0, doc: {}, fieldAt: {}, progress: { badges: [], daily: null, weekly: null, at: 0 }, calls: [], offline: false };
    const profileOf = (q) => {
      const day = q.get("day");
      const week = q.get("week");
      const last = srv.events.reduce((m, e) => (!m || e.at > m.at ? e : m), null);
      const xp = srv.events.reduce((n, e) => n + e.xp, 0);
      return {
        xp, level: levelFor(xp).level, levelName: levelFor(xp).name, streak: srv.events.some((e) => e.xp > 0) ? 2 : 0, week,
        weekXp: srv.events.filter((e) => e.week === week).reduce((n, e) => n + e.xp, 0), day,
        todayBreaks: srv.events.filter((e) => e.day === day).length, breaks: srv.events.length,
        lastBreakAt: last?.at ?? null, lastBreakDay: last?.day ?? null,
        badges: srv.progress.badges, daily: srv.progress.daily, weekly: srv.progress.weekly,
      };
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (srv.offline) throw new TypeError("Failed to fetch");
      const u = new URL(url);
      const method = init.method ?? "GET";
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      srv.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: init.headers?.Authorization });
      const json = (o, status = 200) => new Response(o === null ? null : JSON.stringify(o), { status });
      switch (`${method} ${u.pathname}`) {
        case "POST /sync/breaks": {
          if (body.events.length < 1 || body.events.length > 200) return json({ message: "1 to 200 events" }, 400);
          let accepted = 0;
          for (const e of body.events) if (!srv.events.some((x) => x.id === e.id)) (srv.events.push({ ...e, seq: ++srv.seq }), accepted++);
          return json({ accepted, profile: profileOf(u.searchParams) });
        }
        case "GET /sync/breaks": {
          const since = Number(u.searchParams.get("since"));
          const page = srv.events.filter((e) => e.seq > since).slice(0, Number(u.searchParams.get("limit")));
          return json({ events: page, next: page.length ? page[page.length - 1].seq : since });
        }
        case "GET /me/profile":
          await srv.beforeProfile?.();
          return json(profileOf(u.searchParams));
        case "GET /me/settings":
          return json({ doc: srv.doc, version: 1 });
        case "PATCH /me/settings":
          if (srv.refusePatch) return json({ message: "invalid name" }, 400);
          for (const [k, v] of Object.entries(body.patch)) {
            if (!core.SHARED_SETTINGS[k]) return json({ message: `unknown setting ${k}` }, 400);
            if ((srv.fieldAt[k] ?? 0) > body.at) continue;
            srv.doc[k] = v;
            srv.fieldAt[k] = body.at;
          }
          return json({ doc: srv.doc, version: 2 });
        case "PUT /me/progress":
          if (body.at >= srv.progress.at) srv.progress = body;
          return json(null, 204);
        default:
          return json({ message: "not found" }, 404);
      }
    };
    srv.restore = () => (globalThis.fetch = realFetch);
    srv.ev = (at, extra = {}) => ({
      id: crypto.randomUUID(), at, day: dayKey(at), week: isoWeek(at), device: "ios", reps: 10, moves: 2, score: 80, xp: 12,
      scored: true, completed: true, areas: [], ...extra,
    });
    srv.addRemote = (e) => srv.events.push({ ...e, seq: ++srv.seq });
    return srv;
  };
  const NOW = Date.now();
  const cfg = { url: "https://api.test", session: async () => ({ accessToken: "tok", user: { id: "user-1" } }), now: () => NOW };
  const PLAYER = "11111111-2222-4333-8444-555555555555";
  const oldLog = [
    { at: NOW - 3 * DAY, reps: 12, moves: 3, score: 85, xp: 15, scored: true, completed: true },
    { at: NOW - 2 * DAY, reps: 5, moves: 1, score: null, xp: 0, scored: false, completed: false },
    { at: NOW - DAY, reps: 9, moves: 2, score: 70, xp: 11, scored: true, completed: true },
  ];
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  await acheck("sync: UUIDv5 matches RFC 4122; backfill ids are stable per player and break time", async () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, "www.example.com")
    assert.equal(await core.uuidv5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
    const a = await core.backfillId(PLAYER, 1_762_000_000_000);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(a, await core.backfillId(PLAYER, 1_762_000_000_000));
    assert.equal(a, await core.uuidv5(`${PLAYER}:1762000000000`, core.BACKFILL_NAMESPACE));
    assert.notEqual(a, await core.backfillId(PLAYER, 1_762_000_000_001));
    assert.notEqual(a, await core.backfillId("another-player", 1_762_000_000_000));
  });

  await acheck("sync: backfill gives old entries UUIDv5 ids, keeps queued ids, skips pulled and undatable breaks", async () => {
    const own = { ...oldLog[2], id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
    const pulled = { ...oldLog[0], at: NOW - 4 * DAY, id: "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee", device: "ios" };
    const ancient = { at: Date.UTC(2023, 5, 1), reps: 1, moves: 1, score: 50, xp: 3, scored: true, completed: true };
    const { events, log } = await core.backfillEvents([pulled, ancient, oldLog[0], own], PLAYER, NOW);
    assert.deepEqual(events.map((e) => e.id), [await core.backfillId(PLAYER, oldLog[0].at), own.id]);
    assert.equal(log.length, 4);
    assert.equal(log[1].id, await core.backfillId(PLAYER, ancient.at), "an entry the server won't take still gets its id");
    assert.equal(log[0], pulled);
    assert.equal(events[0].device, "chrome");
    assert.equal(events[0].day, dayKey(oldLog[0].at));
  });

  await acheck("sync: a break event carries the local day and week, clamped to what the server takes", () => {
    const at = new Date(2026, 10, 9, 0, 30).getTime(); // 00:30 local: the UTC day can differ
    const e = core.breakEvent({ at, reps: 20_000, moves: 2.4, score: 140, xp: -5, scored: 1, completed: 0 }, { id: "x", areas: ["Neck tension", "", 5], now: at });
    assert.deepEqual(e, {
      id: "x", at, day: "2026-11-09", week: "2026-W46", device: "chrome", reps: 10_000, moves: 2, score: 100, xp: 0,
      scored: true, completed: false, areas: ["Neck tension"],
    });
    assert.equal(core.breakEvent({ at, score: null }, { id: "y", now: at }).score, null);
    assert.equal(core.breakEvent({ at: at + 2 * DAY }, { id: "z", now: at }), null, "more than 24 h ahead");
    assert.equal(core.breakEvent({ at: Date.UTC(2023, 11, 31) }, { id: "z", now: at }), null, "before 2024");
    assert.equal(core.breakEvent({}, { id: "z", now: at }), null);
  });

  await acheck("sync: the outbox keeps one copy per id, drops the oldest past its cap, and removes sent ids", () => {
    const ev = (id) => ({ id });
    const box = core.addToOutbox([ev("a"), ev("b")], [ev("b"), ev("c"), null, ev("c")]);
    assert.deepEqual(box.map((e) => e.id), ["a", "b", "c"]);
    assert.deepEqual(core.removeFromOutbox(box, ["a", "c", "zz"]).map((e) => e.id), ["b"]);
    const big = core.addToOutbox([], Array.from({ length: core.OUTBOX_MAX + 5 }, (_, i) => ev(`e${i}`)));
    assert.equal(big.length, core.OUTBOX_MAX);
    assert.equal(big[0].id, "e5");
  });

  await acheck("sync: appendLog queues the break with a random UUID, chrome device, local keys and areas", async () => {
    reset();
    const at = NOW - 5 * M;
    await store.appendLog({ at, reps: 10, moves: 3, score: 88, xp: 14, scored: true, completed: true }, { areas: ["Upper back"] });
    const [entry] = await store.readLog();
    const [event] = await store.readOutbox();
    assert.match(entry.id, UUID_V4_RE);
    assert.deepEqual(event, {
      id: entry.id, at, day: dayKey(at), week: isoWeek(at), device: "chrome", reps: 10, moves: 3, score: 88, xp: 14,
      scored: true, completed: true, areas: ["Upper back"],
    });
    await store.appendLog({ at: at + M, reps: 1, moves: 1, score: 50, xp: 2, scored: true, completed: false });
    const box = await store.readOutbox();
    assert.equal(box.length, 2);
    assert.notEqual(box[0].id, box[1].id);
    assert.deepEqual(box[1].areas, []);
  });

  await acheck("sync: saveSettings marks only shared settings that changed, with the time of the change", async () => {
    reset({ intervalMin: 60, theme: "auto" });
    await store.saveSettings({ intervalMin: 60, voice: true, theme: "dark", serverUrl: "ws://x" }, NOW - 2 * M);
    assert.equal(mem.syncDirty, undefined, "unchanged values and device-only settings are not sent");
    await store.saveSettings({ intervalMin: 45, memes: false }, NOW - M);
    await store.saveSettings({ intervalMin: 30, workdays: [1, 2, 3, 4, 5] }, NOW);
    assert.deepEqual(mem.syncDirty, { intervalMin: NOW, memes: NOW - M });
    assert.equal(mem.intervalMin, 30);
  });

  await acheck("sync: settings merge sends per-field times, seeds only unknown keys, and never overwrites unsent changes", () => {
    const settings = { intervalMin: 45, memes: false, theme: "dark", name: "x".repeat(41), mode: "competitive", lang: "auto" };
    const { patches, invalid } = core.dirtyPatches(settings, { memes: NOW - M, intervalMin: NOW, mode: NOW, name: NOW, theme: NOW });
    assert.deepEqual(patches, [{ patch: { memes: false }, at: NOW - M }, { patch: { intervalMin: 45, mode: "competitive" }, at: NOW }]);
    assert.deepEqual(invalid.sort(), ["name", "theme"]);
    assert.deepEqual(core.clearDirty({ memes: NOW - M, intervalMin: NOW + 5 }, { memes: NOW - M, intervalMin: NOW }), { intervalMin: NOW + 5 });
    assert.deepEqual(core.seedPatch({ ...settings, name: "Malik" }, { intervalMin: 30, lang: "ar" }), { memes: false, name: "Malik", mode: "competitive" });
    assert.deepEqual(
      core.remotePatch(settings, { intervalMin: 30, memes: true, mode: "competitive", lang: "xx-123456", serverUrl: "ws://evil" }, { memes: NOW }),
      { intervalMin: 30 },
      "memes has an unsent change, mode is equal, lang is invalid, serverUrl is device-only",
    );
    assert.deepEqual(core.changedSharedKeys({ workdays: [1, 2], theme: "a" }, { workdays: [1, 2], theme: "b", areas: ["Eyes"] }), ["areas"]);
  });

  await acheck("sync: the profile takes XP, streak and week XP from the server and unions badges", () => {
    const local = { ...blankProfile(), xp: 40, streak: 1, lastStreakDay: "2026-11-05", lastBreakDay: "2026-11-05", weekXp: 40, week: "2026-W45", badges: ["daily:a", "weekly:Neck tension", "bad;id"], daily: { day: "x" } };
    const server = { xp: 95, streak: 3, week: "2026-W46", weekXp: 30, lastBreakDay: "2026-11-09", badges: ["daily:b", "daily:a"], daily: null, weekly: { week: "2026-W46" } };
    const p = core.mergeProfile(local, server);
    assert.deepEqual([p.xp, p.streak, p.week, p.weekXp, p.lastBreakDay, p.lastStreakDay], [95, 3, "2026-W46", 30, "2026-11-09", "2026-11-09"]);
    assert.deepEqual(p.badges, ["daily:a", "weekly:Neck tension", "bad;id", "daily:b"]);
    assert.deepEqual([p.daily, p.weekly, p.playerId], [{ day: "x" }, { week: "2026-W46" }, "p"]);
    assert.deepEqual(core.progressOf(p).badges, ["daily:a", "weekly:Neck tension", "daily:b"], "badge ids the server refuses stay local");
    assert.deepEqual(core.progressOf({ badges: ["weekly:Shoulder & rotator cuff", " x", "x "] }).badges, ["weekly:Shoulder & rotator cuff"]);
    const noStreak = core.mergeProfile(local, { ...server, streak: 0, lastBreakDay: "2026-11-04" });
    assert.deepEqual([noStreak.lastBreakDay, noStreak.lastStreakDay], ["2026-11-05", "2026-11-05"]);
  });

  await acheck("sync: pulled events merge into the log once, sorted, with their device", () => {
    const log = [{ at: 10, xp: 1, id: "a" }, { at: 30, xp: 1 }];
    const { log: out, added } = core.mergeLog(log, [{ id: "a", at: 10 }, { id: "b", at: 20, xp: 5, device: "ios", seq: 7, day: "d" }], 500);
    assert.deepEqual(out.map((e) => e.at), [10, 20, 30]);
    assert.equal(added.length, 1);
    assert.equal(out[1].device, "ios");
    assert.equal("seq" in out[1], false);
    assert.equal(core.mergeLog(log, [], 500).log, log);
  });

  await acheck("sync: first sync backfills the old log once, pulls other devices, adopts the server profile and settings", async () => {
    const srv = fakeServer();
    try {
      const phone = srv.ev(NOW - 10 * M, { xp: 20 });
      srv.addRemote(phone);
      srv.doc = { intervalMin: 30 };
      srv.fieldAt = { intervalMin: NOW - DAY };
      reset({
        profile: { ...blankProfile(), playerId: PLAYER, xp: 26, badges: ["daily:clean_form", "weekly:Neck tension", "bad;id"] },
        breakLog: structuredClone(oldLog),
        setupDone: true,
        intervalMin: 45,
        name: "Malik",
        mode: "competitive",
        theme: "dark",
      });
      const res = await syncNow(cfg);
      assert.equal(res.ok, true, res.error);
      assert.equal(res.pending, 0);
      const ids = await Promise.all(oldLog.map((e) => core.backfillId(PLAYER, e.at)));
      assert.deepEqual(srv.events.filter((e) => e.device === "chrome").map((e) => e.id).sort(), [...ids].sort());
      const post = srv.calls.find((c) => c.method === "POST");
      assert.deepEqual(post.query, { day: dayKey(NOW), week: isoWeek(NOW) });
      assert.equal(post.auth, "Bearer tok");
      // Pulled: the phone's break is in the log once, the backfilled ones aren't duplicated.
      const log = await store.readLog();
      assert.equal(log.length, 4);
      assert.deepEqual(log.map((e) => e.id).sort(), [...ids, phone.id].sort());
      assert.equal(log.find((e) => e.id === phone.id).device, "ios");
      assert.equal(mem.syncState.cursor, srv.seq);
      assert.equal(mem.activity[dayKey(phone.at)].xp >= 20, true);
      // Profile: XP from every device.
      const profile = await store.getProfile();
      assert.equal(profile.xp, 15 + 11 + 20);
      assert.equal(profile.playerId, PLAYER);
      assert.equal(res.lastBreakAt, phone.at, "the phone's break is newer than the last one here");
      // Settings: the phone's interval wins (the seed is older than any real change), unknown keys are seeded.
      assert.equal(mem.intervalMin, 30);
      assert.equal(res.scheduleChanged, true);
      assert.deepEqual(srv.doc, { intervalMin: 30, ...core.seedPatch({ ...(await store.getSettings()) }, { intervalMin: 30 }) });
      assert.equal(srv.doc.name, "Malik");
      assert.equal("theme" in srv.doc, false);
      // Progress: badges the server accepts, once.
      const puts = srv.calls.filter((c) => c.method === "PUT");
      assert.equal(puts.length, 1);
      assert.deepEqual(puts[0].body.badges, ["daily:clean_form", "weekly:Neck tension"]);
      assert.deepEqual(profile.badges, ["daily:clean_form", "weekly:Neck tension", "bad;id"]);

      // Again: nothing to send, nothing new to pull, no second backfill or progress PUT.
      srv.calls.length = 0;
      const again = await syncNow(cfg);
      assert.equal(again.ok, true);
      assert.deepEqual(srv.calls.map((c) => `${c.method} ${c.path}`), ["GET /me/settings", "GET /sync/breaks", "GET /me/profile"]);
      assert.equal(again.lastBreakAt, null);
      assert.equal(again.scheduleChanged, false);

      // Even a repeated backfill (state lost) can't count a break twice.
      mem.syncState = { ...mem.syncState, backfilled: false };
      await syncNow(cfg);
      assert.equal(srv.events.length, 4);
    } finally {
      srv.restore();
    }
  });

  await acheck("sync: local changes go up with their time; the outbox goes up in batches of 200; offline keeps everything", async () => {
    const srv = fakeServer();
    try {
      await syncNow(cfg); // state from the previous check: already synced
      srv.calls.length = 0;
      await store.saveSettings({ intervalMin: 20 }, NOW - 1000);
      for (let i = 0; i < 450; i++) await store.appendLog({ at: NOW - 450 * 1000 + i * 1000, reps: 1, moves: 1, score: 60, xp: 1, scored: true, completed: true });
      const res = await syncNow(cfg);
      assert.equal(res.ok, true, res.error);
      assert.deepEqual(srv.calls.filter((c) => c.method === "POST").map((c) => c.body.events.length), [200, 200, 50]);
      const patch = srv.calls.find((c) => c.method === "PATCH");
      assert.deepEqual(patch.body, { patch: { intervalMin: 20 }, at: NOW - 1000 });
      assert.equal(srv.doc.intervalMin, 20);
      assert.deepEqual(mem.syncDirty, {});
      assert.equal((await store.readOutbox()).length, 0);
      assert.equal(srv.events.length, 450, "a fresh server: only the new breaks were waiting");

      srv.offline = true;
      await store.appendLog({ at: NOW, reps: 3, moves: 1, score: 60, xp: 4, scored: true, completed: true });
      await store.saveSettings({ voice: false }, NOW);
      const xpBefore = (await store.getProfile()).xp;
      const off = await syncNow(cfg);
      assert.deepEqual([off.ok, off.reason], [false, "offline"]);
      assert.equal((await store.readOutbox()).length, 1);
      assert.deepEqual(mem.syncDirty, { voice: NOW });
      assert.equal((await store.getProfile()).xp, xpBefore);
      srv.offline = false;
      assert.equal((await syncNow(cfg)).ok, true);
      assert.equal((await store.readOutbox()).length, 0);
      assert.equal(srv.doc.voice, false);
    } finally {
      srv.restore();
    }
  });

  await acheck("sync: signed out or unconfigured never calls the server; a new account starts over", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("fetch called"));
    try {
      assert.deepEqual(await syncNow({ ...cfg, session: async () => null }), { ok: false, reason: "signed-out" });
      assert.deepEqual(await syncNow({ ...cfg, url: "" }), { ok: false, reason: "off" });
    } finally {
      globalThis.fetch = realFetch;
    }
    const srv = fakeServer();
    try {
      const res = await syncNow({ ...cfg, session: async () => ({ accessToken: "t2", user: { id: "user-2" } }) });
      assert.equal(res.ok, true, res.error);
      assert.equal(mem.syncState.user, "user-2");
      assert.equal(srv.calls.find((c) => c.method === "GET" && c.path === "/sync/breaks").query.since, "0");
      const log = await store.readLog();
      assert.equal(log.filter((e) => e.device === "ios").length, 1);
      assert.deepEqual(srv.events.map((e) => e.id).sort(), log.filter((e) => !e.device).map((e) => e.id).sort(), "this device's own breaks, not the one pulled for user-1");
    } finally {
      srv.restore();
    }
  });

  await acheck("sync: a refused settings change is dropped, and a break finished mid-sync keeps its local XP", async () => {
    const srv = fakeServer();
    try {
      await syncNow(cfg);
      srv.refusePatch = true;
      await store.saveSettings({ memes: true }, NOW);
      srv.beforeProfile = async () => {
        srv.beforeProfile = null;
        const p = await store.getProfile();
        await store.setProfile({ ...p, xp: p.xp + 7 });
        await store.appendLog({ at: NOW, reps: 3, moves: 1, score: 60, xp: 7, scored: true, completed: true });
      };
      const xp = (await store.getProfile()).xp;
      const res = await syncNow(cfg);
      assert.equal(res.ok, true, res.error);
      assert.deepEqual(mem.syncDirty, {});
      assert.equal((await store.getProfile()).xp, xp + 7, "not replaced by a server total that misses the new break");
      assert.equal((await store.readOutbox()).length, 1);
    } finally {
      srv.restore();
    }
  });

  await acheck("leaderboard: with sync on, submitScore doesn't PUT (the server writes the row); leaving still DELETEs", async () => {
    const del = fakeFetch(204);
    try {
      assert.equal(await submitScore(blankProfile(), competitor, {}, { ...signedIn, sync: true }), true);
      assert.equal(del.calls.length, 0);
      assert.equal(await submitScore(blankProfile(), competitor, { remove: true }, { ...signedIn, sync: true }), true);
      assert.deepEqual(del.calls.map((c) => c.method), ["DELETE"]);
    } finally {
      del.restore();
    }
  });

  if (!hadChrome) delete globalThis.chrome;
}

// ---- Avatar characters: every one poses its 3D figure through squats, issues,
// reps, buff and droop with nothing broken or non-finite. WebGL isn't
// available in Node, so this drives the physics and scene graph; rendering is
// checked in the browser.
{
  const THREE = await import("../lib/vendor/three.js");
  const { Avatar } = await import("../avatar.js");
  // A standing pose (normalised camera coords) that sinks into a squat by `k` (0..1), arms rising.
  const pose = (k) => {
    const lms = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
    const at = (i, x, y) => (lms[i] = [x, y + k * 0.12 * (y < 0.7 ? 1 : 0), 1]);
    [[0, 0.5, 0.17], [2, 0.53, 0.155], [5, 0.47, 0.155], [7, 0.555, 0.165], [8, 0.445, 0.165], [11, 0.6, 0.31], [12, 0.4, 0.31],
      [13, 0.66, 0.45], [14, 0.34, 0.45], [15, 0.68 - k * 0.1, 0.58 - k * 0.3], [16, 0.32 + k * 0.1, 0.58 - k * 0.3], [23, 0.56, 0.58],
      [24, 0.44, 0.58], [25, 0.6, 0.73], [26, 0.4, 0.73], [27, 0.575, 0.88], [28, 0.425, 0.88], [31, 0.6, 0.92], [32, 0.4, 0.92]]
      .forEach(([i, x, y]) => at(i, x, y));
    return lms;
  };
  const finiteScene = (scene) => {
    const bad = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (o.visible && !o.matrixWorld.elements.every(Number.isFinite)) bad.push(o.type);
    });
    return bad;
  };
  const keys = Object.keys(Avatar.CHARACTERS);
  check("avatars: eight original characters, each with a label", () => {
    assert.deepEqual(keys, ["slothbear", "bunny", "penguin", "dragon", "critter", "platypus", "monster", "robot"]);
    for (const k of keys) assert.ok(Avatar.CHARACTERS[k].label, `${k} has no label`);
  });
  check("avatars: an unknown key falls back to a real character", () => {
    assert.ok(keys.includes(Avatar.create("surfer").key));
  });
  for (const key of keys) {
    check(`avatars: ${key} poses through squats, issues, reps, buff and droop with finite transforms`, () => {
      for (const fitness of [{}, { buff: 1 }, { droop: 1 }]) {
        const a = Avatar.create(key, fitness);
        assert.equal(a.key, key);
        let meshes = 0;
        a.scene.traverse((/** @type {Mesh} */ o) => (meshes += o.isMesh ? 1 : 0));
        assert.ok(meshes > 20, `only ${meshes} meshes`);
        for (let f = 0; f < 90; f++) {
          const p = a.update(pose((Math.sin(f / 8) + 1) / 2), 640, 480, { issues: f % 30 > 20, now: f * 33 });
          if (f > 2) assert.ok(p, "no pose from a full body");
          if (f % 25 === 0) a.celebrate(f % 50 === 0);
          assert.deepEqual(finiteScene(a.scene), [], `non-finite transform at frame ${f}`);
        }
        a.update(null, 640, 480, { now: 99 * 33 });
        a.dispose();
      }
    });
  }
  check("avatars: the heart and star celebration particles fly as 3D meshes", () => {
    const a = Avatar.create("bunny");
    for (let f = 0; f < 5; f++) a.update(pose(0), 640, 480, { now: f * 33 });
    a.celebrate(true);
    a.update(pose(0), 640, 480, { now: 6 * 33 });
    let shown = 0;
    a.scene.traverse((/** @type {Mesh} */ o) => (shown += o.visible && o.geometry?.type === "ExtrudeGeometry" ? 1 : 0));
    assert.ok(shown >= 16, `only ${shown} particles visible`);
    assert.ok(THREE.ExtrudeGeometry);
  });
  check("avatars: zoomed out, a person filling the camera frame fits in view, feet on the floor", () => {
    // Head near the top edge, feet near the bottom: a close, full-frame camera shot.
    const lms = pose(0).map(([x, y, v]) => [0.5 + (x - 0.5) * 1.15, 0.12 + (y - 0.17) * 1.1, v]);
    for (const key of keys) {
      const a = Avatar.create(key);
      let p = null;
      for (let f = 0; f < 30; f++) p = a.update(lms, 640, 480, { now: f * 33 });
      // The figure's real top, ears, hats, horns and antennas included (world y is up).
      a.scene.updateMatrixWorld(true);
      let maxY = -Infinity;
      a.scene.traverse((/** @type {Mesh} */ o) => {
        if (!o.isMesh || !o.visible) return;
        for (let q = o.parent; q; q = q.parent) if (!q.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        maxY = Math.max(maxY, o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).max.y);
      });
      const top = -maxY;
      const ankles = Math.max(...p.legs.map((l) => l[2].y));
      assert.ok(top >= 0, `${key} is cut off at the top (${top.toFixed(0)}px)`);
      assert.ok(ankles > 480 * 0.78 && ankles < 480 * 0.95, `${key}'s feet at ${ankles.toFixed(0)}px, not on the floor`);
    }
  });
  check("avatars: no WebGL means unsupported, so the blur mask stands in", () => {
    assert.equal(Avatar.supported(), false);
  });
}
