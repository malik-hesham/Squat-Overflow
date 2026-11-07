import { getSettings, getProfile, setProfile, getSchedule, setSchedule, appendLog } from "./lib/store.js";
import { award } from "./lib/xp.js";
import { initialSchedule, onFire, applyAction, rescheduleForInterval } from "./lib/schedule.js";
import { submitScore } from "./lib/leaderboard.js";
import { noteAction } from "./lib/challenges.js";

const BREAK_URL = chrome.runtime.getURL("break.html");
const BREAK_WINDOW = { width: 520, height: 780 };
const ALARM = "next-break";
const BADGE_TICK = "badge-tick";

async function windowExists(id) {
  if (id == null) return false;
  try {
    await chrome.windows.get(id);
    return true;
  } catch {
    return false;
  }
}

async function updateBadge() {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  if (!settings.setupDone || !s.nextAt) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const left = Math.max(0, Math.ceil((s.nextAt - Date.now()) / 60_000));
  await chrome.action.setBadgeBackgroundColor({ color: left <= 0 ? "#ff6b6b" : "#3ddc97" });
  await chrome.action.setBadgeText({ text: left <= 0 ? "move" : left >= 100 ? `${Math.round(left / 60)}h` : `${left}m` });
  await chrome.action.setTitle({ title: `StandUp Break: next break in ${left} min` });
}

async function saveSchedule(s) {
  await setSchedule(s);
  if (s.nextAt) await chrome.alarms.create(ALARM, { when: s.nextAt });
  await updateBadge();
}

async function ensureAlarm() {
  const settings = await getSettings();
  if (!(await chrome.alarms.get(BADGE_TICK))) await chrome.alarms.create(BADGE_TICK, { periodInMinutes: 1 });
  if (!settings.setupDone) return;
  const s = await getSchedule();
  if (!s.nextAt) {
    await saveSchedule({ ...initialSchedule(Date.now(), settings.intervalMin), lastKey: s.lastKey, breakCount: s.breakCount });
    return;
  }
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { when: Math.max(s.nextAt, Date.now() + 1000) });
  await updateBadge();
}

async function openReminder({ manual }) {
  const s = await getSchedule();
  if (await windowExists(s.windowId)) {
    await chrome.windows.update(s.windowId, { focused: true });
    return;
  }
  const win = await chrome.windows.create({
    url: BREAK_URL + (manual ? "#manual" : ""),
    type: "popup",
    focused: true,
    ...BREAK_WINDOW,
  });
  await setSchedule({ ...(await getSchedule()), windowId: win.id });
}

async function onNextBreak() {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  if (!settings.setupDone) return;
  const now = Date.now();
  const next = onFire(s, now, settings.intervalMin);
  await saveSchedule(next);
  if (await windowExists(s.windowId)) return;
  await openReminder({ manual: false });
}

async function onDone(msg, s, settings) {
  const now = Date.now();
  const profile = await getProfile();
  const result = msg.result;
  const { profile: next, breakdown, levelUp, newBadges } = award(profile, result, now, settings.workdays);
  await setProfile(next);
  submitScore(next, settings);
  const scores = result.scores ?? [];
  await appendLog({
    at: now,
    reps: result.countedReps,
    moves: result.moves.filter((m) => m.completed).length,
    score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    xp: breakdown.total,
    scored: result.scored,
    completed: result.moves.length > 0 && result.moves.every((m) => m.completed),
  });
  await saveSchedule({
    ...applyAction(s, "done", now, settings.intervalMin),
    lastKey: msg.lastKey ?? s.lastKey,
    breakCount: s.breakCount + 1,
  });
  return { ok: true, breakdown, levelUp, newBadges, profile: next };
}

async function onBreakAction(msg) {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  if (msg.action === "done") return onDone(msg, s, settings);
  await setProfile(noteAction(await getProfile(), msg.action, Date.now()));
  await saveSchedule(applyAction(s, msg.action, Date.now(), settings.intervalMin));
  return { ok: true };
}

async function onPause() {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  await saveSchedule({ ...applyAction(s, "pause", Date.now(), settings.intervalMin), windowId: s.windowId });
  return { ok: true };
}

async function onResume() {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  await saveSchedule({ ...rescheduleForInterval(s, Date.now(), settings.intervalMin), pausedUntil: 0 });
  return { ok: true };
}

async function onLeftBoard() {
  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  return { ok: await submitScore(profile, settings, { remove: true }) };
}

async function onSettingsSaved(msg) {
  const [settings, s, profile] = await Promise.all([getSettings(), getSchedule(), getProfile()]);
  submitScore(profile, settings);
  if (!s.nextAt) await saveSchedule({ ...initialSchedule(Date.now(), settings.intervalMin), lastKey: s.lastKey, breakCount: s.breakCount });
  else if (msg.intervalChanged) await saveSchedule(rescheduleForInterval(s, Date.now(), settings.intervalMin));
  else await ensureAlarm();
  return { ok: true };
}

const HANDLERS = {
  "break-now": () => openReminder({ manual: true }).then(() => ({ ok: true })),
  "break-action": onBreakAction,
  pause: onPause,
  "settings-saved": onSettingsSaved,
  resume: onResume,
  "left-board": onLeftBoard,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) onNextBreak();
  else if (alarm.name === BADGE_TICK) updateBadge();
});

chrome.windows.onRemoved.addListener(async (id) => {
  const s = await getSchedule();
  if (s.windowId !== id) return;
  const settings = await getSettings();
  await setProfile(noteAction(await getProfile(), "close", Date.now()));
  await saveSchedule(applyAction(s, "close", Date.now(), settings.intervalMin));
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
