// Background: opens the trainer from the toolbar icon, and runs the desk break
// coach. The coach counts minutes of keyboard/mouse activity (chrome.idle) on a
// 1-minute alarm; after `breakInterval` active minutes it shows a notification
// that opens the trainer straight into a 2-minute guided break. Stepping away
// for IDLE_RESET_MIN minutes counts as a break on its own and resets the clock.
//
// A service worker is stopped when idle, so all coach state lives in
// chrome.storage.local, never in variables.
const TRAINER_URL = chrome.runtime.getURL("trainer.html");

const SETTINGS_DEFAULTS = { breakEnabled: true, breakInterval: 50 };
const COACH_KEY = "breakCoach"; // { activeMin, awaySince, snoozeUntil, notifiedAt }
const LOG_KEY = "breakLog"; // [{ at, reps, moves, score, completed }]
const LOG_MAX = 500;
const TICK = "break-tick";
const NOTIFICATION_ID = "formcoach-break";
const IDLE_SECONDS = 60; // no input for this long = not at the keyboard
const IDLE_RESET_MIN = 5; // away this long = a natural break
const SNOOZE_MIN = 10;
const RENOTIFY_MIN = 15; // ignored reminder: ask again after this long

// ---------------------------------------------------------------------------
// Opening the trainer
// ---------------------------------------------------------------------------
// Two trainer tabs would fight over the webcam, so an open one is reused.
async function openTrainer(hash = "") {
  const url = TRAINER_URL + hash;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [TRAINER_URL],
    });
    const existing = contexts.find((c) => c.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, {
        active: true,
        ...(hash ? { url } : {}),
      });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch (err) {
    console.warn("Could not look for an open trainer tab:", err);
  }
  const win = await chrome.windows.getLastFocused().catch(() => null);
  await chrome.tabs.create({ url, ...(win ? { windowId: win.id } : {}) });
  if (win) await chrome.windows.update(win.id, { focused: true }).catch(() => {});
}

// A unique hash makes the trainer's hashchange fire even if it is already on #break.
const breakHash = () => `#break-${Date.now()}`;

chrome.action.onClicked.addListener(() => openTrainer());

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function getSettings() {
  return { ...SETTINGS_DEFAULTS, ...(await chrome.storage.local.get(Object.keys(SETTINGS_DEFAULTS))) };
}

async function getCoach() {
  const { [COACH_KEY]: coach } = await chrome.storage.local.get(COACH_KEY);
  return { activeMin: 0, awaySince: null, snoozeUntil: 0, notifiedAt: null, ...coach };
}

const setCoach = (coach) => chrome.storage.local.set({ [COACH_KEY]: coach });

// ---------------------------------------------------------------------------
// The minute tick
// ---------------------------------------------------------------------------
async function ensureAlarm() {
  if (!(await chrome.alarms.get(TICK))) {
    await chrome.alarms.create(TICK, { periodInMinutes: 1 });
  }
}

async function tick() {
  const settings = await getSettings();
  const coach = await getCoach();
  if (!settings.breakEnabled) {
    await updateBadge(settings, coach);
    return;
  }
  const now = Date.now();
  const idle = await chrome.idle.queryState(IDLE_SECONDS);
  if (idle === "active") {
    coach.awaySince = null;
    coach.activeMin += 1;
  } else {
    coach.awaySince ??= now;
    if (now - coach.awaySince >= IDLE_RESET_MIN * 60_000) {
      coach.activeMin = 0; // they got up: that was a break
      coach.notifiedAt = null;
      chrome.notifications.clear(NOTIFICATION_ID);
    }
  }

  const due = coach.activeMin >= Number(settings.breakInterval);
  const snoozed = now < coach.snoozeUntil;
  const recentlyAsked = coach.notifiedAt && now - coach.notifiedAt < RENOTIFY_MIN * 60_000;
  if (due && !snoozed && !recentlyAsked && idle === "active") {
    coach.notifiedAt = now;
    await notify(coach.activeMin);
  }
  await setCoach(coach);
  await updateBadge(settings, coach);
}

async function notify(minutes) {
  await chrome.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Time for a 2-minute desk break",
    message: `You've been at your desk for ${minutes} min. 3 quick moves, coached by your camera.`,
    buttons: [{ title: "Start break" }, { title: `Snooze ${SNOOZE_MIN} min` }],
    requireInteraction: true,
    priority: 2,
  });
}

async function updateBadge(settings, coach) {
  if (!settings.breakEnabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const left = Number(settings.breakInterval) - coach.activeMin;
  await chrome.action.setBadgeBackgroundColor({ color: left <= 0 ? "#ff6b6b" : "#3ddc97" });
  await chrome.action.setBadgeText({ text: left <= 0 ? "move" : `${left}m` });
  await chrome.action.setTitle({
    title: left <= 0 ? "FormCoach: time for a break" : `FormCoach: next break in ${left} min`,
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) tick();
});

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  if (id !== NOTIFICATION_ID) return;
  chrome.notifications.clear(id);
  if (index === 0) {
    await openTrainer(breakHash());
  } else {
    const coach = await getCoach();
    coach.snoozeUntil = Date.now() + SNOOZE_MIN * 60_000;
    coach.notifiedAt = null;
    await setCoach(coach);
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== NOTIFICATION_ID) return;
  chrome.notifications.clear(id);
  await openTrainer(breakHash());
});

// Settings changed in the trainer: refresh the badge right away.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !("breakEnabled" in changes || "breakInterval" in changes)) return;
  await updateBadge(await getSettings(), await getCoach());
});

// Messages from the trainer page (only our own extension pages can send these).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    if (msg?.type === "break-done") {
      const { [LOG_KEY]: log = [] } = await chrome.storage.local.get(LOG_KEY);
      log.push({
        at: Date.now(),
        reps: Number(msg.reps) || 0,
        moves: Number(msg.moves) || 0,
        score: msg.score == null ? null : Number(msg.score),
        completed: msg.completed === true,
      });
      await chrome.storage.local.set({ [LOG_KEY]: log.slice(-LOG_MAX) });
      const coach = await getCoach();
      Object.assign(coach, { activeMin: 0, notifiedAt: null, snoozeUntil: 0 });
      await setCoach(coach);
      chrome.notifications.clear(NOTIFICATION_ID);
      await updateBadge(await getSettings(), coach);
      sendResponse({ ok: true });
    } else if (msg?.type === "break-test") {
      // Demo helper: show the reminder now, as if the interval had passed.
      const coach = await getCoach();
      coach.notifiedAt = Date.now();
      await setCoach(coach);
      await notify(Math.max(coach.activeMin, 1));
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true; // async response
});
