import { getSettings, getProfile, getSchedule, readLog } from "./lib/store.js";
import { LEVELS, levelFor, dayKey } from "./lib/xp.js";
import { upcoming } from "./lib/schedule.js";
import { fetchBoard, submitScore } from "./lib/leaderboard.js";

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

let period = "week";

function boardRow(r) {
  const li = document.createElement("li");
  li.classList.toggle("me", r.is_me);
  const rank = document.createElement("span");
  rank.className = "rank";
  rank.textContent = `#${r.rank}`;
  const who = document.createElement("span");
  who.textContent = r.name;
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent = LEVELS[r.level - 1]?.name ?? "";
  who.append(sub);
  const pts = document.createElement("span");
  pts.className = "pts";
  pts.textContent = `${r.xp} XP · 🔥${r.streak}`;
  li.append(rank, who, pts);
  return li;
}

async function renderBoard() {
  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  const rows = $("boardRows");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.period === period));
  if (settings.mode !== "competitive") {
    rows.replaceChildren();
    $("boardMsg").textContent = `Switch to Competitive to join ${settings.company || "your company"}'s board`;
    return;
  }
  $("boardMsg").textContent = "Loading…";
  await submitScore(profile, settings);
  const board = await fetchBoard(settings.company, period, profile.playerId);
  if (!board) {
    rows.replaceChildren();
    $("boardMsg").textContent = "Leaderboard unavailable";
    return;
  }
  rows.replaceChildren(...board.map(boardRow));
  $("boardMsg").textContent = board.length ? "" : "No scores yet this week. Be the first!";
}

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    period = t.dataset.period;
    renderBoard();
  }),
);

chrome.storage.onChanged.addListener(render);
setInterval(render, 30_000);
render();
renderBoard();
