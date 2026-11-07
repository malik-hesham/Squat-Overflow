import { getSettings, getProfile, setProfile, getSchedule, setSchedule, appendLog } from "./lib/store.js";
import { award } from "./lib/xp.js";
import { initialSchedule, applyAction, rescheduleForInterval, decideFire, nextActiveSlot, IDLE_SEC } from "./lib/schedule.js";
import { submitScore } from "./lib/leaderboard.js";
import { noteAction } from "./lib/challenges.js";
import { createSerial } from "./lib/serial.js";

const BREAK_URL = chrome.runtime.getURL("break.html");
const BREAK_WINDOW = { width: 520, height: 780 };
const ALARM = "next-break";
const BADGE_TICK = "badge-tick";
const serial = createSerial();

async function isBreakWindow(id) {
  if (id == null) return false;
  try {
    const win = await chrome.windows.get(id, { populate: true });
    return win.tabs.some((tab) => (tab.url || tab.pendingUrl || "").startsWith(BREAK_URL));
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

async function saveSchedule(schedule) {
  const settings = await getSettings();
  const s = schedule.nextAt ? { ...schedule, nextAt: nextActiveSlot(schedule.nextAt, settings.intervalMin, settings) } : schedule;
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

async function openBreakWindowId(s) {
  if (await isBreakWindow(s.windowId)) return s.windowId;
  if (await isBreakWindow(s.extraWindowId)) return s.extraWindowId;
  return null;
}

async function openReminder({ manual }) {
  const s = await getSchedule();
  const open = await openBreakWindowId(s);
  if (open != null) {
    await chrome.windows.update(open, { focused: true });
    return;
  }
  const win = await chrome.windows.create({
    url: BREAK_URL + (manual ? "#manual" : ""),
    type: "popup",
    focused: true,
    ...BREAK_WINDOW,
  });
  await setSchedule(manual ? { ...s, windowId: null, extraWindowId: win.id } : { ...s, windowId: win.id });
}

const MEETING_HOSTS = [/^meet\.google\.com$/, /(^|\.)zoom\.us$/, /^teams\.microsoft\.com$/, /^teams\.live\.com$/];

async function inMeeting() {
  const wins = await chrome.windows.getAll();
  if (wins.some((w) => w.state === "fullscreen")) return true;
  const tabs = await chrome.tabs.query({ audible: true });
  return tabs.some((tab) => {
    try {
      const host = new URL(tab.url).hostname;
      return MEETING_HOSTS.some((re) => re.test(host));
    } catch {
      return false;
    }
  });
}

async function onNextBreak() {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  if (!settings.setupDone) return;
  const now = Date.now();
  const [idle, meeting] = await Promise.all([chrome.idle.queryState(IDLE_SEC), inMeeting()]);
  const { kind, schedule } = decideFire(s, now, settings.intervalMin, { idle, meeting, settings });
  await saveSchedule(schedule);
  if (kind !== "open" || (await openBreakWindowId(s)) != null) return;
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
    extraWindowId: s.windowId ?? s.extraWindowId ?? null,
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
  else if (msg.scheduleChanged) await saveSchedule(rescheduleForInterval(s, Date.now(), settings.intervalMin));
  else await saveSchedule(s);
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
  serial(() => handler(msg)).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) serial(onNextBreak);
  else if (alarm.name === BADGE_TICK) updateBadge();
});

chrome.windows.onRemoved.addListener((id) =>
  serial(async () => {
    const s = await getSchedule();
    if (s.windowId !== id) return;
    const settings = await getSettings();
    await setProfile(noteAction(await getProfile(), "close", Date.now()));
    await saveSchedule(applyAction(s, "close", Date.now(), settings.intervalMin));
  }),
);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
  serial(ensureAlarm);
});

chrome.runtime.onStartup.addListener(() =>
  serial(async () => {
    await setSchedule({ ...(await getSchedule()), windowId: null, extraWindowId: null });
    await ensureAlarm();
  }),
);
serial(ensureAlarm);
