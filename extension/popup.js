import { getSettings, getProfile, getSchedule, readLog } from "./lib/store.js";
import { levelFor, dayKey } from "./lib/xp.js";
import { upcoming } from "./lib/schedule.js";

const $ = (id) => document.getElementById(id);
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

let paused = false;

async function render() {
  const [settings, profile, s, log] = await Promise.all([getSettings(), getProfile(), getSchedule(), readLog()]);
  const now = Date.now();
  const lv = levelFor(profile.xp);
  $("levelName").textContent = `Lv ${lv.level} · ${lv.name}`;
  $("levelXp").textContent = lv.next ? `${profile.xp} / ${lv.next} XP` : `${profile.xp} XP · max`;
  $("levelBar").style.width = `${lv.progress * 100}%`;

  $("setup").hidden = settings.setupDone;
  $("nextCard").hidden = !settings.setupDone;
  paused = s.pausedUntil > now;
  $("pause").textContent = paused ? "Resume" : "Pause 1 hr";
  if (paused) {
    $("nextText").textContent = `Paused until ${hhmm(s.pausedUntil)}`;
  } else if (s.nextAt) {
    const mins = Math.max(0, Math.ceil((s.nextAt - now) / 60_000));
    $("nextText").textContent = `Next break at ${hhmm(s.nextAt)} · in ${mins} min`;
  } else {
    $("nextText").textContent = "Not scheduled yet";
  }
  $("shifted").hidden = !(s.shiftedBy > 0 && s.nextAt && !paused);
  if (s.shiftedBy > 0 && s.nextAt) {
    $("shifted").textContent = `Shifted +${s.shiftedBy} min: ${upcoming(s, settings.intervalMin, 3).map(hhmm).join(" · ")}`;
  }

  const today = dayKey(now);
  $("todayDone").textContent = log.filter((b) => dayKey(b.at) === today).length;
  $("skips").textContent = s.skipsInRow ?? 0;
  $("streak").textContent = profile.streak;
}

$("breakNow").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "break-now" });
  window.close();
});
$("pause").addEventListener("click", () => chrome.runtime.sendMessage({ type: paused ? "resume" : "pause" }));
$("practice").addEventListener("click", () => chrome.tabs.create({ url: "trainer.html" }));
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("finishSetup").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener(render);
setInterval(render, 30_000);
render();
