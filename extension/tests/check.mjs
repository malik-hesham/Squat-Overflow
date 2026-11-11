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
import { Session, CATALOG as POSE_CATALOG, DEFAULT_EXERCISE, OFFICE_EXERCISES, EXERCISES, exerciseCatalog, JOINTS, Pose } from "../lib/pose/index.js";
import { trunkTwist } from "../lib/pose/exercises.js";
import { DEMO_PARTS, demoLandmarks, demoMotion, demoPose, demoScene, demoTurn, demoView, reach } from "../lib/demo-model.js";
import { paintDemo } from "../lib/demo-player.js";
import { DEMO_LOOK } from "../lib/demo-look.js";
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

// Mirrors the pose catalog (lib/pose/exercises.js): five or six exercises per pain area.
const AREA_KEYS = {
  "Neck tension": ["neck_tilt", "head_turn", "chin_to_chest", "shoulder_shrug", "chin_tuck"],
  "Rounded shoulders": ["cross_swing", "wy_raise", "shoulder_roll", "thoracic_extension", "clasp_opener"],
  "Upper back": ["seated_row", "t_raise", "desk_punch", "rhomboid_stretch", "desk_row"],
  "Shoulder & rotator cuff": ["scaption", "front_raise", "overhead_reach", "external_rotation", "cross_body_stretch", "seated_jacks"],
  "Lower back": ["seated_side_bend", "knee_to_chest", "hip_hinge", "standing_side_bend", "back_extension", "trunk_rotation"],
  "Wrist & hand": ["wrist_flex", "extensor_stretch", "flexor_stretch", "prayer_stretch", "nerve_glide"],
  Knees: ["seated_knee_ext", "heel_slide", "sit_to_stand", "mini_squat", "hamstring_curl", "seated_march"],
  Eyes: ["palming", "temple_massage", "look_far", "near_far_focus", "eye_track_vertical"],
};
const SIDE_ON = new Set(["chin_tuck", "thoracic_extension", "clasp_opener", "seated_row", "desk_punch", "rhomboid_stretch", "desk_row",
  "front_raise", "knee_to_chest", "hip_hinge", "back_extension", "wrist_flex", "extensor_stretch", "flexor_stretch", "seated_knee_ext",
  "heel_slide", "sit_to_stand", "mini_squat", "hamstring_curl", "near_far_focus", "eye_track_vertical", "trunk_rotation", "seated_march"]);
const STANDING = new Set(["clasp_opener", "desk_row", "hip_hinge", "standing_side_bend", "back_extension", "sit_to_stand", "mini_squat", "hamstring_curl"]);
const CATALOG = Object.entries(AREA_KEYS).flatMap(([category, keys]) =>
  keys.map((key) => ({
    key,
    label: key,
    category,
    camera: SIDE_ON.has(key) ? "side" : "front",
    stance: STANDING.has(key) ? "standing" : "seated",
    how_to: `do ${key}`,
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

check("every area has five or six catalog exercises, the same as the pose catalog's", () => {
  assert.deepEqual(Object.keys(AREA_KEYS), AREAS);
  for (const a of AREAS) assert.ok([5, 6].includes(CATALOG.filter((e) => e.category === a).length), a);
  const pick = ({ key, category, camera, stance }) => ({ key, category, camera, stance });
  assert.deepEqual(exerciseCatalog().map(pick), CATALOG.map(pick));
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

check("leaderboard API is the local API server, and the manifest CSP lets pages reach it", () => {
  assert.equal(API_URL, "http://127.0.0.1:8765");
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const connectSrc = manifest.content_security_policy.extension_pages.match(/connect-src([^;]*)/)[1].trim().split(/\s+/);
  const api = new URL(API_URL);
  assert.ok(connectSrc.includes(`${api.protocol}//${api.hostname}:*`), "CSP connect-src misses the API origin");
  assert.ok(!connectSrc.some((src) => src.includes("fly.dev")), "CSP still allows the old Fly.io host");
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
  const move = (k) => ({ key: k, label: k, area: byKey(k).category, camera: byKey(k).camera, how_to: "", target: BREAK_REPS });
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
check("session: sign-in and refresh POST to the API server's auth API and map the reply", () => {
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
check("manifest: WASM may run (the pose model), and pages can't reach a pose server", () => {
  const csp = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.doesNotMatch(csp, /\bwss?:\/\//);
});
check("i18n: no pose server strings left, in any language", () => {
  const keys = translationKeys("en");
  for (const key of ["serverUrl", "errServer", "coachOffline", "offlineText", "coachBusy", "busyText"]) assert.ok(!keys.includes(key), `${key} is still there`);
  for (const key of keys) assert.doesNotMatch(t("en", key), /pose server/i, key);
  for (const key of ["coachUnavailable", "unavailableText"]) assert.ok(keys.includes(key), `missing ${key}`);
});
check("i18n: the 3D demo's strings exist in every language, the YouTube credit is gone", () => {
  for (const lang of LANGS.filter((l) => l !== "auto")) {
    const keys = translationKeys(lang);
    for (const key of ["watchDemo", "hideDemo", "demoHint", "demoLabel"]) assert.ok(keys.includes(key), `${lang}: missing ${key}`);
    assert.ok(!keys.includes("demoCredit"), `${lang}: demoCredit is still there`);
    for (const key of keys) assert.doesNotMatch(t(lang, key), /youtube|يوتيوب/i, `${lang}: ${key}`);
  }
  assert.match(t("en", "demoLabel", { move: "Chin tuck" }), /Chin tuck/);
});
/**
 * A side-view squat at knee angle `deg`, in normalised image coordinates (the shape of
 * mobile/src/pose/analysis/__tests__/synthetic.ts's `squat`, kept small). The right side is a
 * low-visibility copy, as when the camera sees one side.
 */
function squatPose(deg) {
  const lms = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9]);
  const ankle = [500, 900];
  const knee = [500, 700];
  const r = (deg * Math.PI) / 180;
  // The hip sits 200 px from the knee, `deg` away from the shin, behind the knee.
  const hip = [knee[0] - 200 * Math.sin(r), knee[1] + 200 * Math.cos(r)];
  const shoulder = [hip[0] + 250 * Math.sin(Math.PI / 18), hip[1] - 250 * Math.cos(Math.PI / 18)];
  const pts = { ankle, knee, hip, shoulder, heel: [480, 915], toe: [560, 915], elbow: [shoulder[0], shoulder[1] + 120], wrist: [shoulder[0], shoulder[1] + 240] };
  for (const [side, vis] of /** @type {[import("../lib/pose/index.js").Side, number][]} */ ([["left", 0.95], ["right", 0.2]])) {
    for (const [joint, idx] of Object.entries(JOINTS[side])) if (pts[joint]) lms[idx] = [pts[joint][0] / 1000, pts[joint][1] / 1000, vis];
  }
  return lms;
}

check("pose: the catalog lists the office moves in order, the first is the default", () => {
  const catalog = exerciseCatalog();
  assert.deepEqual(catalog.map((e) => e.key), OFFICE_EXERCISES.map((e) => e.key));
  assert.equal(DEFAULT_EXERCISE, catalog[0].key);
  assert.ok(catalog.every((e) => Object.hasOwn(POSE_CATALOG, e.key)));
});

/**
 * A seated torso filmed side-on from the person's left, 500 px from mid-hip to mid-shoulder, with
 * a typical adult's shoulders (0.76 torso lengths) and hips (0.4). The hips are turned `sit` degrees
 * from side-on, the shoulders `twist` more.
 */
function twistPose(twist, sit = 0, useWorld = false) {
  const lms = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9]);
  const world = Array.from({ length: 33 }, () => [0, 0, 0]);
  for (const [joint, half, up, deg] of /** @type {["shoulder" | "hip", number, number, number][]} */ ([["shoulder", 190, 500, twist + sit], ["hip", 100, 0, sit]])) {
    for (const [side, s] of /** @type {["left" | "right", number][]} */ ([["left", 1], ["right", -1]])) {
      const r = (deg * Math.PI) / 180;
      const across = s * half * Math.cos(r); // towards the camera
      const back = s * half * Math.sin(r); // the picture's x
      lms[JOINTS[side][joint]] = [(500 + back) / 1000, (700 - up) / 1000, 0.95];
      world[JOINTS[side][joint]] = [back / 1000, -up / 1000, -across / 1000];
    }
  }
  return new Pose(lms, 1000, 1000, world, useWorld);
}

check("pose: trunk twist is the shoulders' turn against the hips, side-on in 2D and in 3D", () => {
  for (const twist of [0, 10, 25, 40]) {
    for (const sit of [0, 15, -20]) {
      for (const useWorld of [false, true]) {
        const got = trunkTwist(twistPose(twist, sit, useWorld), "left");
        assert.ok(Math.abs(got - twist) < 1e-6, `twist ${twist}, sitting ${sit} off side-on, ${useWorld ? "3D" : "2D"}: read ${got}`);
      }
    }
  }
  // Either way round, and the left/right labels can't make a square torso read as turned.
  assert.ok(Math.abs(trunkTwist(twistPose(-30), "left") - 30) < 1e-6);
  assert.ok(Math.abs(trunkTwist(twistPose(-30, 0, true), "left") - 30) < 1e-6);
  assert.ok(trunkTwist(twistPose(180, 0, true), "left") < 1e-6);
});

// ---- 3D exercise demo (lib/demo-model.js) ------------------------------------
const DEMO_KEYS = Object.keys(EXERCISES);
const FPS = 30;
/**
 * Samples a demo at 30 fps.
 * @param {string} key
 * @returns {[number, number[][]][]} [t, joints] per frame
 */
function demoLoop(key, loops = 1) {
  const { seconds } = demoMotion(key);
  return Array.from({ length: Math.round(seconds * FPS * loops) }, (_, i) => [i / FPS, demoPose(key, i / FPS)]);
}
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MIRROR = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
/** The same pose seen in a mirror: x flips and left and right swap. */
function mirrored(joints) {
  const out = joints.map(([x, y, z]) => [-x, y, z]);
  for (const [l, r] of MIRROR) [out[l], out[r]] = [out[r], out[l]];
  return out;
}
const BONES = [[11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20], [11, 12], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [27, 31], [28, 30], [28, 32]];

check("3D demo: every exercise has one, an unknown move has none", () => {
  for (const key of DEMO_KEYS) {
    const m = demoMotion(key);
    assert.ok(m, `${key} has no demo`);
    assert.ok(m.seconds >= 2 && m.seconds <= 8, `${key}: a loop of ${m.seconds} s`);
    assert.ok(m.reps === 1 || m.reps === 2, `${key}: ${m.reps} reps a loop`);
    const pose = demoPose(key, 0);
    assert.equal(pose.length, 33);
    assert.ok(pose.every((p) => p.length === 3 && p.every(Number.isFinite)), `${key}: a joint is not a 3D point`);
  }
  assert.equal(demoMotion("moonwalk"), null);
  assert.equal(demoPose("moonwalk", 0), null);
});

check("3D demo: each loop ends where it starts, and no joint jumps between frames", () => {
  for (const key of DEMO_KEYS) {
    const { seconds } = demoMotion(key);
    for (const t of [0, 0.7, 1.9]) {
      const a = demoPose(key, t);
      const b = demoPose(key, t + seconds);
      assert.ok(a.every((p, i) => gap(p, b[i]) < 1e-9), `${key} doesn't loop at ${t} s`);
    }
    const frames = demoLoop(key);
    frames.forEach(([t, pose], i) => {
      const prev = i ? frames[i - 1][1] : demoPose(key, -1 / FPS);
      const jump = Math.max(...pose.map((p, j) => gap(p, prev[j])));
      // 8 cm a frame is 2.4 m/s: quicker than any move here, far slower than a jump cut.
      assert.ok(jump < 0.08, `${key}: a joint jumps ${jump.toFixed(3)} m at ${t.toFixed(2)} s`);
    });
  }
});

/**
 * The biggest one-frame change in a series of 3D points' acceleration, as a share of their peak
 * acceleration (null when they barely accelerate). A smooth move changes its acceleration a bit each
 * frame; a stop or start at full acceleration, or a kink in the path, changes it all at once.
 * @param {number[][]} path points, evenly spaced in time
 * @param {number} still peak below which the points barely move (m per frame squared)
 */
function jolt(path, still) {
  const acc = path.slice(1, -1).map((p, i) => p.map((v, a) => path[i + 2][a] - 2 * v + path[i][a]));
  const peak = Math.max(...acc.map((v) => Math.hypot(...v)));
  if (peak < still) return null;
  return Math.max(...acc.slice(1).map((v, i) => Math.hypot(...v.map((x, a) => x - acc[i][a])))) / peak;
}

check("3D demo: every move eases in and out like a person, with no jolt: no joint's acceleration jumps", () => {
  const F = 120; // finer than a screen: at 30 fps a fast smooth move and a jolt look alike
  for (const key of DEMO_KEYS) {
    const { seconds } = demoMotion(key);
    const poses = Array.from({ length: Math.round(seconds * F) + 3 }, (_, i) => demoPose(key, (i - 1) / F));
    for (let j = 0; j < 33; j++) {
      const share = jolt(poses.map((p) => p[j]), 1.25e-5);
      assert.ok(share === null || share <= 0.4, `${key}: joint ${j}'s acceleration jumps by ${Math.round(share * 100)}% of its peak in one frame`);
    }
  }
});

check("3D demo: a seated person stays seated: the hips never rise or sink", () => {
  for (const key of DEMO_KEYS.filter((k) => demoMotion(k).stance === "seated")) {
    const heights = demoLoop(key).map(([, p]) => (p[23][1] + p[24][1]) / 2);
    const spread = Math.max(...heights) - Math.min(...heights);
    assert.ok(spread < 1e-6, `${key}: the hips go ${(spread * 100).toFixed(1)} cm up and down on the seat`);
  }
});

check("3D demo: an arm reaching past its length straightens smoothly, with no snap at full stretch", () => {
  /** @type {[number, number, number]} */
  const shoulder = [0.19, 1.4, 0];
  const [a, b] = [0.29, 0.26];
  // The hand's target slides away from 0.4 m (in reach) to 0.7 m (well out of reach).
  const wrists = Array.from({ length: 151 }, (_, i) => reach(shoulder, [0.19 + 0.4 + i * 0.002, 1.4, 0.1], [0, -1, 0], a, b)[1]);
  const dist = wrists.map((w) => Math.hypot(w[0] - shoulder[0], w[1] - shoulder[1], w[2] - shoulder[2]));
  assert.ok(dist.every((d, i) => d < a + b && (!i || d >= dist[i - 1] - 1e-12)), "the hand moves out, never past the arm's length");
  assert.ok(dist.at(-1) > (a + b) * 0.99, `at full stretch the arm is nearly straight (${dist.at(-1).toFixed(3)} m)`);
  const share = jolt(wrists, 0);
  assert.ok(share <= 0.4, `the hand stops dead at full stretch: its acceleration jumps ${Math.round(share * 100)}% in one step`);
});

check("3D demo: a move done one side at a time works both sides in each loop", () => {
  for (const key of DEMO_KEYS.filter((k) => demoMotion(k).reps === 2)) {
    const half = demoMotion(key).seconds / 2;
    for (const t of [0.4, 1, 1.3]) {
      const second = demoPose(key, t + half);
      const first = mirrored(demoPose(key, t));
      assert.ok(first.every((p, i) => gap(p, second[i]) < 1e-9), `${key}: the second side isn't the first one mirrored at ${t} s`);
    }
  }
  // The moves whose instructions say to switch sides.
  for (const key of ["neck_tilt", "head_turn", "cross_body_stretch", "seated_side_bend", "knee_to_chest", "standing_side_bend", "trunk_rotation", "seated_knee_ext", "heel_slide", "hamstring_curl", "seated_march"]) {
    assert.equal(demoMotion(key).reps, 2, `${key} should work both sides`);
  }
});

check("3D demo: the figure is rigid, no limb stretches or shrinks", () => {
  for (const key of DEMO_KEYS) {
    const frames = demoLoop(key);
    for (const [a, b] of BONES) {
      const lengths = frames.map(([, p]) => gap(p[a], p[b]));
      const spread = Math.max(...lengths) - Math.min(...lengths);
      assert.ok(spread < 1e-6, `${key}: bone ${a}-${b} changes length by ${spread.toFixed(4)} m`);
    }
  }
});

check("3D demo: the body stands (or sits) on the floor, and a planted foot doesn't slide", () => {
  for (const key of DEMO_KEYS) {
    const frames = demoLoop(key);
    for (const [t, pose] of frames) {
      const low = Math.min(...pose.map((p) => p[1]));
      assert.ok(Math.abs(low) < 1e-6, `${key}: the lowest point is ${low.toFixed(3)} m off the floor at ${t.toFixed(2)} s`);
    }
    if (key === "heel_slide") continue; // the move is a slide
    frames.forEach(([t, pose], i) => {
      if (!i) return;
      const prev = frames[i - 1][1];
      for (const toe of [31, 32]) {
        if (pose[toe][1] > 0.01 || prev[toe][1] > 0.01) continue; // not on the floor
        const slide = Math.hypot(pose[toe][0] - prev[toe][0], pose[toe][2] - prev[toe][2]);
        assert.ok(slide < 0.002, `${key}: the foot on the floor slides ${slide.toFixed(4)} m at ${t.toFixed(2)} s`);
      }
    });
  }
});

check("3D demo: a camera sees the figure the way MediaPipe reports a person", () => {
  const size = { width: 640, height: 480 };
  const front = demoLandmarks("t_raise", 0, size);
  assert.equal(front.length, 33);
  assert.ok(front.every((l) => l.length === 3 && l[2] === 1 && l[0] > 0 && l[0] < 1 && l[1] > 0 && l[1] < 1), "a joint is off the picture");
  assert.ok(front[11][0] > front[12][0], "the person's left shoulder is on the right of the picture");
  assert.ok(front[0][1] < front[11][1] && front[11][1] < front[23][1] && front[23][1] < front[27][1], "y grows downwards");
  // A side-camera move is seen from the side: the shoulders line up, the nose points away from the ears.
  const side = demoLandmarks("chin_tuck", 0, size);
  assert.ok(Math.abs(side[11][0] - side[12][0]) < 0.01, "the shoulders should line up from the side");
  assert.ok(Math.abs(side[0][0] - side[7][0]) > 0.02);
  // Any other angle on request.
  const turned = demoLandmarks("chin_tuck", 0, { ...size, yaw: 0 });
  assert.ok(turned[11][0] - turned[12][0] > 0.05);
  assert.equal(demoLandmarks("moonwalk", 0, size), null);
});

check("3D demo: from its camera, every demo counts its reps on the coach's own rep counter, cleanly", () => {
  const W = 640;
  const H = 480;
  for (const key of DEMO_KEYS) {
    const { seconds, reps } = demoMotion(key);
    const session = new Session(key);
    const loops = 3;
    const events = [];
    for (let i = 0; i < Math.round(seconds * loops * FPS); i++) {
      const t = i / FPS;
      const out = session.process(demoLandmarks(key, t, { width: W, height: H }), W, H, t);
      assert.deepEqual(out.feedback, [], `${key}: the coach says ${JSON.stringify(out.feedback)} at ${t.toFixed(2)} s`);
      if (out.rep_event) events.push(out.rep_event);
    }
    const partial = events.filter((r) => r.partial);
    assert.deepEqual(partial.map((r) => r.peak_angle), [], `${key}: partial reps`);
    assert.equal(events.length, reps * loops, `${key}: ${events.length} reps in ${loops} loops, expected ${reps * loops}`);
    for (const r of events) assert.deepEqual(r.issues, [], `${key}: rep ${r.index} flagged ${r.issues}`);
  }
});

check("3D demo: the view swings gently around the coach's camera, and the user can turn it", () => {
  const size = { width: 320, height: 240 };
  assert.equal(demoView("t_raise", 0, size).yaw, 0); // a front-camera move starts face on
  assert.equal(demoView("chin_tuck", 0, size).yaw, 90); // a side-camera one from the person's left
  const swing = [0, 2, 4, 6, 8, 10, 12, 14].map((t) => demoView("t_raise", t, size).yaw);
  assert.ok(Math.max(...swing) > 15 && Math.min(...swing) < -15 && Math.max(...swing.map(Math.abs)) <= 30, `swings ${swing}`);
  assert.equal(demoView("t_raise", 4, { ...size, turn: 90 }).yaw, demoView("t_raise", 4, size).yaw + 90);
  assert.equal(demoView("t_raise", 4, { ...size, still: true }).yaw, 0); // reduced motion: no swing
  assert.ok(demoView("t_raise", 0, size).pitch > 0, "seen from a little above, so the floor shows");
  assert.equal(demoView("moonwalk", 0, size), null);
});

check("3D demo: dragging right turns the figure's front to the right, from any camera", () => {
  const size = { width: 640, height: 480 };
  // Like grabbing a globe: the side of the head facing the camera (the nose from the front, the
  // near ear from the side) follows the finger, measured from the middle of the head.
  for (const [key, near] of /** @type {[string, number][]} */ ([["t_raise", 0], ["chin_tuck", 7]])) {
    const facing = (turn) => {
      const l = demoLandmarks(key, 0, demoView(key, 0, { ...size, turn, still: true }));
      return l[near][0] - (l[7][0] + l[8][0]) / 2;
    };
    assert.ok(facing(demoTurn(40)) > facing(0), `${key}: dragging right turns the figure to the left`);
    assert.ok(facing(demoTurn(-40)) < facing(0), `${key}: dragging left turns the figure to the right`);
  }
  assert.equal(demoTurn(0), 0);
});

check("3D demo: an arm keeps its lengths even when the elbow hint points along it", () => {
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** @typedef {[number, number, number]} P3 */
  /** @type {P3} */
  const shoulder = [0.19, 1.4, 0];
  for (const [target, pole] of /** @type {[P3, P3][]} */ ([
    [[0.19, 1.0, 0], [0, -1, 0]], // reaching straight down, hint straight down
    [[0.19, 1.0, 0], [0, 1, 0]], // hint straight back up the arm
    [[0.5, 1.4, 0.2], [0, 0, 0]], // no hint at all
  ])) {
    const [elbow, wrist] = reach(shoulder, target, pole, 0.29, 0.26);
    assert.ok(Math.abs(len(shoulder, elbow) - 0.29) < 1e-9, `upper arm ${len(shoulder, elbow)} for pole ${pole}`);
    assert.ok(Math.abs(len(elbow, wrist) - 0.26) < 1e-9, `forearm ${len(elbow, wrist)} for pole ${pole}`);
    assert.ok(len(wrist, target) < 1e-6, "the wrist reaches a reachable spot");
  }
});

check("3D demo: the scene fits its canvas, is painted far to near, and turns with the camera", () => {
  const size = { width: 320, height: 240 };
  const inside = (x, y, r) => x - r >= -0.5 && y - r >= -0.5 && x + r <= size.width + 0.5 && y + r <= size.height + 0.5;
  for (const key of DEMO_KEYS) {
    for (const yaw of [0, 45, 90, 135, 180, 270]) {
      for (const t of [0, 1.3, 2.1]) {
        const shapes = demoScene(key, t, { ...size, yaw, pitch: 12 });
        assert.ok(shapes.length > 30, `${key}: ${shapes.length} shapes`);
        shapes.forEach((sh, i) => {
          assert.ok(["capsule", "circle", "ellipse", "poly"].includes(sh.kind), sh.kind);
          if (sh.kind === "poly") assert.ok(sh.points.length >= 6 && sh.points.length % 2 === 0 && sh.points.every(Number.isFinite), `${key}: ${sh.part} outline`);
          else assert.ok(Object.values(sh).every((v) => typeof v === "string" || Number.isFinite(v)), `${key}: ${JSON.stringify(sh)}`);
          const ok =
            sh.kind === "capsule" ? inside(sh.x1, sh.y1, sh.r) && inside(sh.x2, sh.y2, sh.r)
            : sh.kind === "circle" ? inside(sh.x, sh.y, sh.r)
            : sh.kind === "ellipse" ? inside(sh.x, sh.y, Math.max(sh.rx, sh.ry))
            : sh.points.every((v, j) => inside(j % 2 ? 0 : v, j % 2 ? v : 0, 0));
          assert.ok(ok, `${key} at yaw ${yaw}: ${sh.part} ${sh.kind} leaves the canvas`);
          if (i) assert.ok(shapes[i - 1].depth >= sh.depth, `${key}: shape ${i} is painted out of depth order`);
        });
      }
    }
  }
  const view = { ...size, yaw: 0, pitch: 12 };
  assert.deepEqual(demoScene("t_raise", 1, view), demoScene("t_raise", 1, view));
  assert.notDeepEqual(demoScene("t_raise", 1, view), demoScene("t_raise", 1, { ...view, yaw: 30 }));
  assert.notDeepEqual(demoScene("t_raise", 0, view), demoScene("t_raise", 1.5, view));
  assert.equal(demoScene("moonwalk", 0, view), null);
});

check("3D demo: just the person and a shadow: no joint marks and no chair", () => {
  const view = { width: 320, height: 240, yaw: 30, pitch: 12 };
  for (const key of DEMO_KEYS) {
    for (const t of [0, 1.3]) {
      const parts = new Set(demoScene(key, t, view).map((sh) => sh.part));
      assert.ok(!parts.has("joint"), `${key}: the joints the coach measures are marked`);
      assert.ok(!parts.has("chair"), `${key}: a chair is drawn`);
      assert.ok(parts.has("shadow") && parts.has("head"), key);
    }
  }
});

// ---- The demo's look (lib/demo-look.js) ------------------------------------------
/** Hue of a "#rrggbb" colour in degrees: shading towards black or white keeps it. @param {string} hex */
const hueOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
/** @param {string} a @param {string} b */
const sameHue = (a, b) => {
  const d = Math.abs(hueOf(a) - hueOf(b));
  return Math.min(d, 360 - d) < 4;
};
/** @param {string} hex */
const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
};
/** A look with one hue per colour, so a test can tell what each part wears through the shading. */
const TEST_LOOK = {
  colors: { skin: "#d08040", hair: "#c040c0", beard: "#8040c0", top: "#e04040", bottoms: "#4040e0", stripe: "#e0e040", shoes: "#40c040", eyes: "#40c0c0" },
  wear: { head: "skin", neck: "skin", shoulders: "skin", torso: "top", upperArm: "skin", forearm: "skin", hand: "skin", hips: "bottoms", thigh: "bottoms", knee: "skin", shin: "skin", foot: "shoes" },
  size: { head: 0.13, neck: 0.05, shoulders: 0.06, torso: 0.115, upperArm: 0.064, forearm: 0.052, hand: 0.04, hips: 0.1, thigh: 0.088, knee: 0.052, shin: 0.058, foot: 0.05 },
};
const LOOK_VIEW = { width: 320, height: 240, yaw: 30, pitch: 12 };
const FRONT = { width: 640, height: 480, yaw: 0, pitch: 0 };
/** @param {number[]} pts flat x, y list */
const boxOf = (pts) => {
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
/**
 * How wide an outline is across a bone, at `f` of the way from joint a to joint b (picture px).
 * @param {number[]} pts flat x, y list @param {number[]} a @param {number[]} b @param {number} f
 */
function across(pts, a, b, f) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [dx, dy] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const [px, py] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const hits = [];
  for (let i = 0; i < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[(i + 2) % pts.length], pts[(i + 3) % pts.length]];
    const [sa, sb] = [(ax - px) * dx + (ay - py) * dy, (bx - px) * dx + (by - py) * dy];
    if (sa <= 0 !== sb <= 0) {
      const k = sa / (sa - sb);
      hits.push((ax + (bx - ax) * k - px) * -dy + (ay + (by - ay) * k - py) * dx);
    }
  }
  return hits.length ? Math.max(...hits) - Math.min(...hits) : 0;
}
/** Where a move's joints are in the picture, px. @param {string} key @param {number} t @param {typeof FRONT} view */
const jointsAt = (key, t, view) => demoLandmarks(key, t, view).map(([x, y]) => [x * view.width, y * view.height]);
/** The outline of `part` nearest the middle of joints a and b. */
function outlineOf(shapes, part, a, b) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const centre = (sh) => {
    const box = boxOf(sh.points);
    return Math.hypot((box.x0 + box.x1) / 2 - mid[0], (box.y0 + box.y1) / 2 - mid[1]);
  };
  const mine = shapes.filter((sh) => sh.part === part && sh.kind === "poly");
  assert.ok(mine.length, `no ${part} drawn`);
  return mine.sort((p, q) => centre(p) - centre(q))[0];
}

check("3D demo look: the default look is the reference character: a tank top, bare arms, a beard and a stripe down the shorts", () => {
  for (const part of ["shoulders", "upperArm", "forearm"]) assert.equal(DEMO_LOOK.wear[part], "skin", `${part} should be bare`);
  assert.equal(DEMO_LOOK.wear.torso, "top");
  assert.equal(DEMO_LOOK.wear.thigh, "bottoms");
  assert.equal(DEMO_LOOK.wear.knee, "skin", "shorts, not trousers");
  assert.ok(DEMO_LOOK.colors.beard, "a beard");
  assert.ok(DEMO_LOOK.colors.stripe, "a stripe down the shorts");
});

check("3D demo look: the person is drawn as filled outlines, each limb tapering from its root to its end", () => {
  const key = "standing_side_bend"; // standing, arms hanging, at rest
  const shapes = demoScene(key, 0, FRONT, TEST_LOOK);
  for (const part of Object.keys(TEST_LOOK.wear)) {
    const mine = shapes.filter((sh) => sh.part === part);
    assert.ok(mine.some((sh) => sh.kind === "poly"), `${part} isn't drawn as an outline`);
  }
  const j = jointsAt(key, 0, FRONT);
  for (const [part, a, b] of /** @type {[string, number, number][]} */ ([["upperArm", 11, 13], ["forearm", 13, 15], ["shin", 25, 27]])) {
    const pts = outlineOf(shapes, part, j[a], j[b]).points;
    const [root, end] = [across(pts, j[a], j[b], 0.25), across(pts, j[a], j[b], 0.75)];
    assert.ok(root > end * 1.12, `${part}: ${root.toFixed(1)} px wide near its root, ${end.toFixed(1)} px near its end`);
  }
});

check("3D demo look: a broad chest over a narrower waist", () => {
  const key = "standing_side_bend";
  const shapes = demoScene(key, 0, FRONT, TEST_LOOK);
  const j = jointsAt(key, 0, FRONT);
  const hips = [(j[23][0] + j[24][0]) / 2, (j[23][1] + j[24][1]) / 2];
  const top = [(j[11][0] + j[12][0]) / 2, (j[11][1] + j[12][1]) / 2];
  const torso = shapes.find((sh) => sh.part === "torso" && sh.kind === "poly");
  assert.ok(torso?.kind === "poly", "no torso outline");
  const [chest, waist] = [across(torso.points, hips, top, 0.72), across(torso.points, hips, top, 0.3)];
  assert.ok(chest > waist * 1.1, `chest ${chest.toFixed(1)} px, waist ${waist.toFixed(1)} px`);
});

check("3D demo look: a beard round the jaw from the front, out of sight from behind; none without a beard colour", () => {
  /** @param {number} yaw @param {import("../lib/demo-look.js").DemoLook} [look] */
  const order = (yaw, look = TEST_LOOK) => {
    const shapes = demoScene("chin_tuck", 0, { ...LOOK_VIEW, yaw }, look);
    const at = (part) => shapes.flatMap((sh, i) => (sh.part === part ? [i] : []));
    return { head: shapes.findIndex((sh) => sh.part === "head" && sh.kind === "poly"), beard: at("beard"), face: at("face"), eyes: at("eyes") };
  };
  const front = order(0);
  assert.ok(front.beard.length, "no beard drawn");
  assert.ok(Math.min(...front.beard) > front.head, "from the front the beard is on the face");
  assert.ok(Math.min(...front.eyes) > Math.max(...front.face), "the eyes are on the face");
  const back = order(180);
  assert.ok(Math.max(...back.beard) < back.head, "from behind the head hides the beard");
  const { beard, ...shaven } = TEST_LOOK.colors;
  assert.ok(beard);
  assert.deepEqual(order(0, { ...TEST_LOOK, colors: shaven }).beard, [], "a clean-shaven look has a beard");
});

check("3D demo look: a stripe down the outer seam of the shorts, on the sides facing the camera; none without a stripe colour", () => {
  /** @param {number} yaw @param {import("../lib/demo-look.js").DemoLook} [look] */
  const scene = (yaw, look = TEST_LOOK) => demoScene("standing_side_bend", 0, { ...FRONT, yaw }, look);
  const stripes = (shapes) => shapes.filter((sh) => sh.part === "stripe");
  assert.equal(stripes(scene(0)).length, 2, "from the front both legs show their stripe");
  assert.equal(stripes(scene(180)).length, 2, "from behind too");
  for (const yaw of [90, -90]) {
    const shapes = scene(yaw);
    assert.equal(stripes(shapes).length, 1, `from the side (yaw ${yaw}) only the near leg's stripe shows`);
    const thighs = shapes.flatMap((sh, i) => (sh.part === "thigh" ? [i] : []));
    assert.ok(shapes.indexOf(stripes(shapes)[0]) > Math.max(...thighs), "the stripe is on the near leg");
  }
  for (const sh of stripes(scene(0))) assert.ok(sameHue(sh.fill, TEST_LOOK.colors.stripe), sh.fill);
  const { stripe, ...plain } = TEST_LOOK.colors;
  assert.ok(stripe);
  assert.equal(stripes(scene(0, { ...TEST_LOOK, colors: plain })).length, 0, "plain shorts have a stripe");
});

check("3D demo look: clothes cover the skin under them from any side: the top over the shoulders and neck, the shorts over the knees", () => {
  const centre = (sh) => {
    const b = boxOf(sh.points);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  };
  for (const key of ["chin_tuck", "standing_side_bend", "squat", "back_extension"]) {
    for (const yaw of [0, 60, 90, 180, 270]) {
      for (const t of [0, 1.8]) {
        const shapes = demoScene(key, t, { ...LOOK_VIEW, yaw }, TEST_LOOK);
        const fills = (part) => shapes.flatMap((sh, i) => (sh.part === part && sh.kind === "poly" ? [i] : []));
        const [torso] = fills("torso");
        for (const part of ["shoulders", "neck"]) assert.ok(fills(part).every((i) => i < torso), `${key} at yaw ${yaw}: the ${part} are painted over the top`);
        // Each knee lies just under a leg of the shorts (seen side on, both legs overlap in the picture).
        for (const k of fills("knee")) {
          const under = fills("thigh").some((i) => i > k && shapes[k].depth - shapes[i].depth < 2e-3);
          assert.ok(under, `${key} at yaw ${yaw}, ${t} s: a knee is painted over its shorts`);
        }
      }
    }
  }
});

/** The shape painted last over a point of the picture (what you see there). */
function topAt(shapes, x, y) {
  /** @param {number[]} p */
  const inPoly = (p) => {
    let inside = false;
    for (let i = 0, k = p.length - 2; i < p.length; k = i, i += 2) {
      if (p[i + 1] > y !== p[k + 1] > y && x < ((p[k] - p[i]) * (y - p[i + 1])) / (p[k + 1] - p[i + 1]) + p[i]) inside = !inside;
    }
    return inside;
  };
  const covers = (sh) => {
    if (sh.kind === "poly") return inPoly(sh.points);
    if (sh.kind === "circle") return Math.hypot(x - sh.x, y - sh.y) <= sh.r;
    if (sh.kind === "ellipse") return ((x - sh.x) / sh.rx) ** 2 + ((y - sh.y) / sh.ry) ** 2 <= 1;
    const [dx, dy] = [sh.x2 - sh.x1, sh.y2 - sh.y1];
    const f = Math.max(0, Math.min(1, ((x - sh.x1) * dx + (y - sh.y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - sh.x1 - dx * f, y - sh.y1 - dy * f) <= sh.r;
  };
  return shapes.findLast(covers);
}

check("3D demo look: an arm or a leg is one smooth piece: no dark edge across the elbow, wrist or knee", () => {
  // Seen at an angle (a limb flat across the view hides a seam: all of it is as far away), with the
  // limb nearest the camera, so nothing else is in front of it.
  // A leg is looked at from just under the shorts to just above the shoe (the hem and the shoe have
  // edges of their own, like clothes).
  for (const [key, t, yaw, chain, until] of /** @type {[string, number, number, number[], number][]} */ ([
    ["t_raise", 1.8, 40, [11, 13, 15, 19], 95],
    ["curl", 1.8, 50, [11, 13, 15, 19], 95],
    ["nerve_glide", 1.8, -40, [12, 14, 16, 20], 95],
    ["seated_knee_ext", 0.9, 60, [23, 25, 27], 80],
    ["squat", 1.8, 60, [23, 25, 27], 80],
  ])) {
    const view = { ...FRONT, yaw };
    const shapes = demoScene(key, t, view, TEST_LOOK);
    const j = jointsAt(key, t, view);
    for (let s = 0; s < chain.length - 1; s++) {
      const [a, b] = [j[chain[s]], j[chain[s + 1]]];
      for (let step = 5; step <= (s === chain.length - 2 ? until : 95); step++) {
        if (chain[s] === 23 && step < 90) continue; // the shorts
        const f = step / 100; // an edge is ~1 cm wide: look every 1% of the bone
        const top = topAt(shapes, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
        assert.ok(top && top.part !== "outline", `${key} from yaw ${yaw}: a dark edge crosses the limb between joints ${chain[s]} and ${chain[s + 1]} (${Math.round(f * 100)}%)`);
      }
    }
  }
});

check("3D demo look: each body part is painted in the colour it wears", () => {
  for (const key of ["t_raise", "squat", "seated_knee_ext"]) {
    const shapes = demoScene(key, 0.7, LOOK_VIEW, TEST_LOOK);
    for (const [part, colour] of Object.entries(TEST_LOOK.wear)) {
      const mine = shapes.filter((sh) => sh.part === part);
      assert.ok(mine.length, `${key}: no ${part} drawn`);
      for (const sh of mine) assert.ok(sameHue(sh.fill, TEST_LOOK.colors[colour]), `${key}: ${part} is ${sh.fill}, not ${colour}`);
    }
    for (const part of ["hair", "eyes", "beard"]) {
      const mine = shapes.filter((sh) => sh.part === part);
      assert.ok(mine.length, `${key}: no ${part} drawn`);
      for (const sh of mine) assert.ok(sameHue(sh.fill, TEST_LOOK.colors[part]), `${key}: ${part} is ${sh.fill}`);
    }
  }
});

check("3D demo look: changing what a part wears changes that part only (long sleeves, trousers)", () => {
  const dressed = { ...TEST_LOOK, wear: { ...TEST_LOOK.wear, forearm: "top", shin: "bottoms" } };
  const before = demoScene("t_raise", 0.7, LOOK_VIEW, TEST_LOOK);
  const after = demoScene("t_raise", 0.7, LOOK_VIEW, dressed);
  assert.ok(["forearm", "shin"].every((part) => after.some((s) => s.part === part)), "no forearms or shins drawn");
  for (const sh of after.filter((s) => s.part === "forearm")) assert.ok(sameHue(sh.fill, TEST_LOOK.colors.top), `long sleeves: forearm ${sh.fill}`);
  for (const sh of after.filter((s) => s.part === "shin")) assert.ok(sameHue(sh.fill, TEST_LOOK.colors.bottoms), `trousers: shin ${sh.fill}`);
  const others = (shapes) => shapes.filter((s) => !["forearm", "shin", "shade", "outline"].includes(s.part));
  assert.deepEqual(others(after), others(before));
});

check("3D demo look: a part's size sets how thick it is drawn, and nothing else", () => {
  const big = { ...TEST_LOOK, size: { ...TEST_LOOK.size, torso: TEST_LOOK.size.torso * 2 } };
  const [a, b] = [TEST_LOOK, big].map((look) => demoScene("standing_side_bend", 0, FRONT, look));
  const width = (shapes) => {
    const box = boxOf(shapes.find((s) => s.part === "torso" && s.kind === "poly").points);
    return box.x1 - box.x0;
  };
  assert.ok(width(b) > width(a) * 1.3, `torso ${width(a).toFixed(1)} -> ${width(b).toFixed(1)} px`);
  const others = (shapes) => shapes.filter((s) => !["torso", "outline", "shade"].includes(s.part));
  assert.deepEqual(others(b), others(a));
});

check("3D demo look: the hair is behind the head seen from the front, and covers it from behind", () => {
  const order = (yaw) => {
    const parts = demoScene("chin_tuck", 0, { ...LOOK_VIEW, yaw }, TEST_LOOK).map((sh) => sh.part);
    return { hair: parts.indexOf("hair"), head: parts.indexOf("head"), eyes: parts.indexOf("eyes") };
  };
  const front = order(0);
  assert.ok(front.hair < front.head && front.head < front.eyes, `from the front: ${JSON.stringify(front)}`);
  const back = order(180);
  assert.ok(back.hair > back.head, `from behind: ${JSON.stringify(back)}`);
});

check("3D demo look: each body part has a darker edge just behind it, so it reads on a light page as on a dark one", () => {
  for (const key of ["squat", "t_raise"]) {
    const shapes = demoScene(key, 0.7, LOOK_VIEW, TEST_LOOK);
    const parts = shapes.filter((sh) => sh.kind === "poly" && Object.hasOwn(TEST_LOOK.wear, sh.part));
    assert.ok(parts.length >= 18, `${key}: ${parts.length} parts`);
    for (const sh of parts) {
      if (sh.kind !== "poly") continue;
      const box = boxOf(sh.points);
      const i = shapes.indexOf(sh);
      const edge = shapes.slice(0, i).reverse().find((e) => {
        if (e.part !== "outline" || e.kind !== "poly") return false;
        const b = boxOf(e.points);
        return b.x0 < box.x0 && b.y0 < box.y0 && b.x1 > box.x1 && b.y1 > box.y1;
      });
      assert.ok(edge?.kind === "poly", `${key}: ${sh.part} has no edge`);
      const eb = boxOf(edge.points);
      assert.ok(eb.x1 - eb.x0 < (box.x1 - box.x0) * 1.6 + 2, `${key}: ${sh.part}'s edge is too wide`);
      assert.ok(luma(edge.fill) < luma(sh.fill) * 0.8 && sameHue(edge.fill, sh.fill), `${key}: ${sh.part} edge ${edge.fill} on ${sh.fill}`);
      // Just behind it, or behind the part of the limb it joins (no seam at the elbow, see below).
      assert.ok(edge.depth >= sh.depth && edge.depth - sh.depth < 0.5, `${key}: ${sh.part}'s edge isn't just behind it`);
    }
  }
});

check("3D demo look: the look file is complete: #rrggbb colours, every part dressed and sized, no unknown parts", () => {
  const body = [...DEMO_PARTS].sort();
  assert.deepEqual(Object.keys(DEMO_LOOK.wear).sort(), body, "wear should list exactly the figure's parts");
  assert.deepEqual(Object.keys(DEMO_LOOK.size).sort(), body, "size should list exactly the figure's parts");
  for (const name of ["hair", "eyes"]) assert.ok(Object.hasOwn(DEMO_LOOK.colors, name), `colors.${name} is missing`);
  for (const [name, colour] of Object.entries(DEMO_LOOK.colors)) assert.match(colour, /^#[0-9a-f]{6}$/i, `colors.${name}`);
  for (const [part, colour] of Object.entries(DEMO_LOOK.wear)) assert.ok(Object.hasOwn(DEMO_LOOK.colors, colour), `wear.${part}: no colour named "${colour}"`);
  for (const [part, r] of Object.entries(DEMO_LOOK.size)) assert.ok(r > 0 && r <= 0.3, `size.${part}: ${r} m`);
  // ...and those are the parts the scene draws.
  const drawn = new Set();
  for (const key of DEMO_KEYS) for (const sh of demoScene(key, 0, LOOK_VIEW)) drawn.add(sh.part);
  const extras = ["shade", "outline", "shadow", "hair", "brows", "eyes", "beard", "face", "stripe"];
  assert.deepEqual([...drawn].filter((p) => !extras.includes(p)).sort(), body);
});

check("3D demo: the canvas painter paints each shape once, in the scene's order", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, name) => (name in ctx_props ? ctx_props[name] : (...args) => calls.push([name, ...args])),
    set: (_, name, value) => (calls.push([`=${String(name)}`, value]), true),
  });
  const ctx_props = {};
  /** @type {import("../lib/demo-model.js").Shape[]} */
  const shapes = [
    { kind: "ellipse", x: 50, y: 90, rx: 30, ry: 6, fill: "rgba(0,0,0,0.2)", depth: 9, part: "shadow" },
    { kind: "capsule", x1: 10, y1: 10, x2: 40, y2: 50, r: 4, fill: "#aa8866", depth: 5, part: "body" },
    { kind: "circle", x: 40, y: 50, r: 3, fill: "#3ddc97", depth: 4, part: "eyes" },
    { kind: "poly", points: [5, 5, 25, 5, 15, 30], fill: "#b8ae76", depth: 3, part: "torso" },
  ];
  paintDemo(/** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (ctx)), shapes);
  const draws = calls.filter(([n]) => ["fill", "stroke"].includes(n)).map(([n]) => n);
  assert.deepEqual(draws, ["fill", "stroke", "fill", "fill"]);
  assert.ok(calls.some(([n, ...a]) => n === "ellipse" && a[0] === 50 && a[2] === 30));
  assert.ok(calls.some(([n, v]) => n === "=lineWidth" && v === 8), "a capsule is a round-capped line as wide as it is thick");
  assert.ok(calls.some(([n, v]) => n === "=lineCap" && v === "round"));
  assert.ok(calls.some(([n, ...a]) => n === "arc" && a[0] === 40 && a[2] === 3));
  const traced = calls.filter(([n]) => n === "moveTo" || n === "lineTo").slice(-3).map(([, x, y]) => [x, y]);
  assert.deepEqual(traced, [[5, 5], [25, 5], [15, 30]], "an outline is traced through its points");
  assert.ok(calls.some(([n]) => n === "closePath"));
});

check("3D demo: no YouTube left, the catalog has no clips and no page links to youtube.com", () => {
  for (const e of exerciseCatalog()) assert.ok(!("demo" in e), `${e.key} still carries a demo clip`);
  const moves = buildRoutine(exerciseCatalog(), { areas: AREAS.slice(0, 2), lastKey: null, n: 0 });
  for (const m of moves) assert.ok(!("demo" in m), `the routine still gives ${m.key} a demo field`);
  assert.throws(() => readFileSync(new URL("../lib/pose/demos.js", import.meta.url)), /ENOENT/);
  const files = [
    "break.html", "break.js", "break.css", "trainer.html", "trainer.js", "trainer.css", "avatar-global.js", "service-worker.js", "manifest.json",
    ...readdirSync(new URL("../lib/pose/", import.meta.url)).map((f) => `lib/pose/${f}`),
    "lib/demo-model.js", "lib/demo-player.js",
  ];
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /youtube/i, f);
});

check("pose: three squats on the device count three clean reps", () => {
  const session = new Session("squat");
  const frames = [];
  for (let rep = 0; rep < 3; rep++) {
    for (let i = 0; i <= 60; i++) frames.push(172 + ((80 - 172) * (1 - Math.cos((2 * Math.PI * i) / 60))) / 2);
  }
  const results = frames.map((deg, i) => session.process(squatPose(deg), 1000, 1000, i / 30));
  const reps = results.flatMap((r) => (r.rep_event ? [r.rep_event] : []));
  assert.deepEqual(reps.map((e) => [e.index, e.score]), [[1, 100], [2, 100], [3, 100]]);
  assert.equal(results.at(-1).summary.reps, 3);
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
  assert.equal(CATALOG.length, 43);
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
      "memes has an unsent change, mode is equal, lang is invalid, serverUrl is not a shared setting",
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

  await acheck("store: no pose server setting; an install or update deletes the retired pose server keys", async () => {
    assert.ok(!("serverUrl" in store.SETTINGS_DEFAULTS));
    const saved = structuredClone(mem); // the sync checks below carry state from the ones above
    try {
      reset({ serverUrl: "ws://127.0.0.1:8765/ws", exerciseCatalog: { exercises: [{ key: "neck_tilt" }] }, intervalMin: 45 });
      await store.dropRetiredKeys();
      assert.deepEqual(Object.keys(mem), ["intervalMin"]);
      assert.ok(!("serverUrl" in (await store.getSettings())));
    } finally {
      reset(saved);
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

// ---- On-device pose (lib/pose/gateway.js, lib/pose/mask.js): the old pose server's /ws protocol,
// answered in the page. Ported from server/test/server/server.spec.ts and mask.spec.ts.
{
  const { createPoseGateway } = await import("../lib/pose/gateway.js");
  const { encodeMask } = await import("../lib/pose/mask.js");
  const { CONNECTIONS } = await import("../lib/pose/index.js");
  const acheck = async (name, fn) => {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (err) {
      console.log(`FAIL ${name}\n  ${err.stack ?? err.message}`);
      process.exitCode = 1;
    }
  };
  /** A gateway whose detector returns the frame it is given, on a clock that moves 5 ms per read. */
  const gateway = () => {
    let ms = 1000;
    return createPoseGateway({ detect: async (frame) => frame, now: () => (ms += 5) });
  };
  const send = (g, msg) => g.handle(typeof msg === "string" ? msg : JSON.stringify(msg));
  const nobody = { width: 640, height: 480, landmarks: null, world: null, mask: null };
  const maskOf = (h, w, fill) => {
    const data = new Float32Array(w * h);
    if (fill) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y) ? 1 : 0;
    return { data, width: w, height: h };
  };
  /** A standing "person": rows 60..299, columns 200..279 of a 360x480 frame. */
  const person = () => maskOf(360, 480, (x, y) => y >= 60 && y < 300 && x >= 200 && x < 280);
  const alphaAt = (m, x, y) => m.alpha[y * m.width + x];

  await acheck("pose gateway: ready lists the whole office catalog, the skeleton and the default move", async () => {
    const ready = gateway().ready();
    assert.equal(ready.type, "ready");
    assert.deepEqual(ready.exercises, exerciseCatalog());
    assert.equal(ready.exercises.length, 43);
    assert.deepEqual(ready.connections, CONNECTIONS);
    assert.equal(ready.exercise, "neck_tilt");
  });

  await acheck("pose gateway: config takes office moves only and reports bad messages like the server did", async () => {
    const g = gateway();
    assert.equal((await send(g, { type: "config", exercise: "curl" }))[0].type, "error"); // Workout set is not offered
    assert.deepEqual(await send(g, { type: "config", exercise: "nerve_glide" }), [{ type: "config", exercise: "nerve_glide", calibrated: false }]);
    assert.deepEqual(await send(g, { type: "config", exercise: ["neck_tilt"] }), [{ type: "error", message: "unknown exercise ['neck_tilt']" }]);
    assert.deepEqual(await send(g, { type: "warp" }), [{ type: "error", message: "unknown message type 'warp'" }]);
    assert.deepEqual(await send(g, "{not json"), [{ type: "error", message: "invalid JSON" }]);
    assert.deepEqual(await send(g, ["not", "an", "object"]), [{ type: "error", message: "expected a JSON object" }]);
    assert.deepEqual(await send(g, { type: "reset" }), [{ type: "config", exercise: "nerve_glide", calibrated: false }]);
  });

  await acheck("pose gateway: a frame with nobody in it says so, with no mask unless privacy is on", async () => {
    const g = gateway();
    await send(g, { type: "config", exercise: "nerve_glide" });
    const [frame] = await g.handle(nobody);
    assert.equal(frame.type, "frame");
    assert.equal(frame.exercise, "nerve_glide");
    assert.equal(frame.landmarks, null);
    assert.equal(frame.feedback[0].code, "not_visible");
    assert.ok(frame.latency_ms > 0);
    assert.ok(!("mask" in frame)); // off by default: nothing to draw

    assert.deepEqual(await send(g, { type: "privacy", enabled: true }), [{ type: "privacy", enabled: true }]);
    assert.equal((await g.handle(nobody))[0].mask, null); // nobody found -> the client blurs everything
    assert.deepEqual(await send(g, { type: "privacy", enabled: "yes" }), [{ type: "privacy", enabled: false }]); // only a real true
  });

  await acheck("pose gateway: landmarks are rounded like the server's, and privacy adds the person's mask", async () => {
    const g = gateway();
    await send(g, { type: "privacy", enabled: true });
    const landmarks = Array.from({ length: 33 }, () => [0.123456, 0.654321, 0.98765]);
    const [frame] = await g.handle({ width: 480, height: 360, landmarks, world: null, mask: person() });
    assert.deepEqual(frame.landmarks[0], [0.1235, 0.6543, 0.988]);
    assert.equal(Math.max(frame.mask.width, frame.mask.height), 160);
    assert.equal(alphaAt(frame.mask, 80, 80), 255);
  });

  await acheck("pose gateway: a frame the detector can't read is an error, and the next one still works", async () => {
    let fail = true;
    const g = createPoseGateway({ detect: async (f) => { if (fail) throw new Error("bad frame"); return f; }, now: () => 0 });
    assert.deepEqual(await g.handle(nobody), [{ type: "error", message: "could not read frame" }]);
    fail = false;
    assert.equal((await g.handle(nobody))[0].type, "frame");
  });

  await acheck("pose gateway: angle mode, calibration thresholds and calibrate start/cancel", async () => {
    const g = gateway();
    assert.deepEqual(await send(g, { type: "angles", mode: "3d" }), [{ type: "angles", mode: "3d", exercise: "neck_tilt" }]);
    assert.equal((await send(g, { type: "angles", mode: "4d" }))[0].type, "error");

    assert.deepEqual(await send(g, { type: "config", exercise: "sit_to_stand", calibration: { rest: 150, target: 120 } }), [
      { type: "config", exercise: "sit_to_stand", calibrated: true },
    ]);
    const th = (await g.handle(nobody))[0].thresholds;
    assert.deepEqual([th.rest, th.target, th.calibrated, th.default_rest, th.default_target], [150, 120, true, 155, 110]);

    // Wrong direction for this exercise: an error, then the switch happens with defaults.
    const replies = await send(g, { type: "config", exercise: "sit_to_stand", calibration: { rest: 100, target: 150 } });
    assert.deepEqual(replies, [{ type: "error", message: "invalid calibration" }, { type: "config", exercise: "sit_to_stand", calibrated: false }]);

    assert.deepEqual(await send(g, { type: "calibrate", action: "start" }), [{ type: "calibrate", action: "start", exercise: "sit_to_stand" }]);
    const frame = (await g.handle(nobody))[0];
    assert.deepEqual(frame.calibration, { status: "recording", reps: 0, needed: 3 });
    assert.equal(frame.angle_mode, "2d"); // nobody found: no world landmarks this frame
    assert.equal((await send(g, { type: "calibrate", action: "cancel" }))[0].action, "cancel");
    assert.ok(!("calibration" in (await g.handle(nobody))[0]));
    assert.equal((await send(g, { type: "calibrate", action: "explode" }))[0].type, "error");
  });

  await acheck("pose gateway: 3D mode measures on the frame's world landmarks (alignWorldY is pinned by mobile's world.parity test)", async () => {
    const g = gateway();
    await send(g, { type: "config", exercise: "sit_to_stand" });
    await send(g, { type: "angles", mode: "3d" });
    const landmarks = Array.from({ length: 33 }, (_, i) => [0.5, i / 33, 0.99]);
    const world = landmarks.map(([x, y]) => [x - 0.5, -(y - 0.5), 0]);
    const [frame] = await g.handle({ width: 640, height: 480, landmarks, world, mask: null });
    assert.equal(frame.angle_mode, "3d");
  });

  check("pose mask: small, with the person in alpha", () => {
    const m = encodeMask(person());
    assert.equal(Math.max(m.width, m.height), 160);
    assert.equal(m.height / m.width, 0.75);
    assert.equal(m.alpha.length, m.width * m.height);
    assert.equal(alphaAt(m, 80, 80), 255); // centre of the person (scaled 1/3)
    assert.equal(alphaAt(m, 5, 5), 0); // far background
  });

  check("pose mask: grown beyond the person, never shrunk", () => {
    const m = encodeMask(person());
    let original = 0;
    let grown = 0;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const inPerson = y * 3 >= 60 && y * 3 < 300 && x * 3 >= 200 && x * 3 < 280;
        const covered = alphaAt(m, x, y) > 127;
        if (inPerson) {
          original++;
          assert.ok(covered, `person pixel ${x},${y} uncovered`);
        }
        if (covered) grown++;
      }
    }
    assert.ok(grown > original * 1.2);
  });

  check("pose mask: landmarks cover the limbs and head the segmentation missed", () => {
    const lms = Array.from({ length: 33 }, () => [0.5, 0.5, 0.0]); // unseen by default
    lms[0] = [0.5, 0.15, 0.99]; // nose
    lms[11] = [0.6, 0.3, 0.99]; // shoulders
    lms[12] = [0.4, 0.3, 0.99];
    lms[13] = [0.75, 0.3, 0.99]; // left arm out sideways
    lms[15] = [0.9, 0.3, 0.99];
    const m = encodeMask(maskOf(360, 480), lms);
    const { width: w, height: h } = m;
    assert.equal(alphaAt(m, Math.round(0.82 * w), Math.round(0.3 * h)), 255); // forearm
    assert.equal(alphaAt(m, Math.round(0.5 * w), Math.round(0.15 * h)), 255); // face
    assert.equal(alphaAt(m, Math.round(0.1 * w), Math.round(0.9 * h)), 0); // background
    assert.equal(alphaAt(m, Math.round(0.6 * w), Math.round(0.7 * h)), 0); // no line to an unseen landmark
  });

  check("pose mask: an empty mask stays empty", () => {
    assert.equal(Math.max(...encodeMask(maskOf(90, 120)).alpha), 0);
  });
}

// ---- On-device pose transport (lib/pose/local-socket.js) and the vendored model (lib/vendor/mediapipe).
{
  const { openPoseSocket } = await import("../lib/pose/local-socket.js");
  const { createPoseGateway } = await import("../lib/pose/gateway.js");
  const { createHash } = await import("node:crypto");
  const acheck = async (name, fn) => {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (err) {
      console.log(`FAIL ${name}\n  ${err.stack ?? err.message}`);
      process.exitCode = 1;
    }
  };
  const nobody = { width: 640, height: 480, landmarks: null, world: null, mask: null };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** Opens a socket on a fake detector; records every event it fires. */
  const open = (detector = { detect: async (f) => f, close() { detector.closed = true; } }) => {
    const events = [];
    const socket = openPoseSocket({ createDetector: async () => detector });
    for (const type of ["open", "message", "close", "error"]) {
      socket.addEventListener(type, (/** @type {any} */ ev) => events.push(type === "message" ? ev.data : type === "close" ? { close: ev.code } : type));
    }
    return { socket, events, detector };
  };

  await acheck("pose socket: connecting until the model loads, then open, then ready first", async () => {
    const { socket, events } = open();
    assert.equal(socket.readyState, socket.CONNECTING);
    await tick();
    assert.equal(socket.readyState, socket.OPEN);
    assert.equal(events[0], "open");
    assert.equal(events[1].type, "ready");
  });

  await acheck("pose socket: replies come back as objects, in the order the messages were sent", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    const detector = { detect: async (f) => (await slow, f), close() {} };
    const { socket, events } = open(detector);
    await tick();
    socket.send(nobody); // held by the slow detector
    socket.send(JSON.stringify({ type: "privacy", enabled: true }));
    await tick();
    assert.equal(events.length, 2); // open, ready: the privacy reply waits for the frame before it
    release();
    await tick();
    await tick();
    assert.deepEqual(events.slice(2).map((m) => m.type), ["frame", "privacy"]);
  });

  await acheck("pose socket: close stops replies and releases the model", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    const detector = { detect: async (f) => (await slow, f), close() { detector.closed = true; } };
    const { socket, events } = open(detector);
    await tick();
    socket.send(nobody);
    socket.close();
    assert.equal(socket.readyState, socket.CLOSED);
    release();
    await tick();
    await tick();
    assert.deepEqual(events, ["open", events[1], { close: 1000 }]);
    assert.equal(detector.closed, true);
    socket.send(nobody); // ignored once closed, like a closed WebSocket
  });

  await acheck("pose socket: a model that fails to load closes with 1011 and never opens", async () => {
    const events = [];
    const socket = openPoseSocket({ createDetector: async () => { throw new Error("no WebGL, no WASM"); } });
    socket.addEventListener("open", () => events.push("open"));
    socket.addEventListener("close", (/** @type {any} */ ev) => events.push([ev.code, ev.reason]));
    await tick();
    assert.deepEqual(events, [[1011, "no WebGL, no WASM"]]);
    assert.equal(socket.readyState, socket.CLOSED);
  });

  await acheck("pose socket: closed while the model loads, the model is released as soon as it arrives", async () => {
    const detector = { detect: async (f) => f, close() { detector.closed = true; } };
    const socket = openPoseSocket({ createDetector: async () => detector });
    socket.close();
    await tick();
    assert.equal(detector.closed, true);
  });

  await acheck("pose gateway: the detector is asked for a person mask only while privacy is on", async () => {
    const asked = [];
    const g = createPoseGateway({ detect: async (f, _ms, opts) => (asked.push(opts.mask), f), now: () => 0 });
    await g.handle(nobody);
    await g.handle(JSON.stringify({ type: "privacy", enabled: true }));
    await g.handle(nobody);
    assert.deepEqual(asked, [false, true]);
  });

  check("pose model: the extension ships the phone's pose_landmarker_lite.task, byte for byte", () => {
    const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, import.meta.url))).digest("hex");
    assert.equal(sha("../lib/vendor/mediapipe/pose_landmarker_lite.task"), sha("../../mobile/modules/squat-pose/assets/pose_landmarker_lite.task"));
  });

  check("pose model: the MediaPipe runtime is vendored, so a break needs no network", () => {
    const files = readdirSync(new URL("../lib/vendor/mediapipe/", import.meta.url));
    for (const f of ["vision_bundle.mjs", "vision_wasm_internal.js", "vision_wasm_internal.wasm", "pose_landmarker_lite.task", "LICENSE"]) {
      assert.ok(files.includes(f), `lib/vendor/mediapipe/${f} missing; run npm run vendor in extension/`);
    }
  });
}
