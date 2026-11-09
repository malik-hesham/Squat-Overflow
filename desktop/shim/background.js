// The desktop app's background page: the extension's service worker, unchanged, plus the tray
// menu's labels. The labels are the popup's own strings (lib/i18n.js), so they follow the language
// setting, and Pause turns into Resume the way the popup's button does (popup.js).
import "./service-worker.js";
import { t, resolveLang } from "./lib/i18n.js";
import { getSettings, getSchedule } from "./lib/store.js";

async function updateMenu() {
  const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
  const lang = resolveLang(settings.lang, navigator.language);
  const paused = s.pausedUntil > Date.now();
  await window.__soShim.setMenu({
    breakNow: t(lang, "breakNow"),
    pause: t(lang, paused ? "resume" : "pause"),
    settings: t(lang, "settings"),
    paused,
  });
}

chrome.storage.onChanged.addListener(updateMenu);
await updateMenu();
// service-worker.js has registered its listeners by now: deliver install/start-up and what queued up.
await window.__soShim.ready();
