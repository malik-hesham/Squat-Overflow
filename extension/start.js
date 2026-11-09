import { startBreakFromLink } from "./lib/start-link.js";
import { initLang, t } from "./lib/i18n.js";
import { initTheme } from "./lib/themes.js";

const lang = await initLang();
initTheme();

const started = await startBreakFromLink({
  send: (msg) => chrome.runtime.sendMessage(msg),
  closeTab: async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) await chrome.tabs.remove(tab.id);
  },
});
if (!started) document.getElementById("status").textContent = t(lang, "startFailed");
