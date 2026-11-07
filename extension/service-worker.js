import { getSettings, getProfile, setProfile, getSchedule, setSchedule, appendLog } from "./lib/store.js";
import { award } from "./lib/xp.js";

const BREAK_URL = chrome.runtime.getURL("break.html");
const BREAK_WINDOW = { width: 520, height: 780 };

async function windowExists(id) {
  if (id == null) return false;
  try {
    await chrome.windows.get(id);
    return true;
  } catch {
    return false;
  }
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

async function onDone(msg) {
  const now = Date.now();
  const [settings, profile, s] = await Promise.all([getSettings(), getProfile(), getSchedule()]);
  const result = msg.result;
  const { profile: next, breakdown, levelUp } = award(profile, result, now, settings.workdays);
  await setProfile(next);
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
  await setSchedule({ ...s, windowId: null, lastKey: msg.lastKey ?? s.lastKey, breakCount: s.breakCount + 1 });
  return { ok: true, breakdown, levelUp, profile: next };
}

async function onBreakAction(msg) {
  if (msg.action === "done") return onDone(msg);
  const s = await getSchedule();
  await setSchedule({ ...s, windowId: null });
  return { ok: true };
}

const HANDLERS = {
  "break-now": () => openReminder({ manual: true }).then(() => ({ ok: true })),
  "break-action": onBreakAction,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
