import { getSettings, getProfile, getSchedule, readLog } from "./lib/store.js";
import { LEVELS, levelFor, dayKey } from "./lib/xp.js";
import { upcoming, isActive } from "./lib/schedule.js";
import { fetchBoard, submitScore } from "./lib/leaderboard.js";
import { DAILY_POOL, WEEKLY, withPeriods } from "./lib/challenges.js";
import { badgeLabel } from "./lib/badges.js";
import { initTheme } from "./lib/themes.js";

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
  } else if (s.nextAt && !isActive(now, settings)) {
    const day = new Date(s.nextAt).toLocaleDateString([], { weekday: "short" });
    $("nextText").textContent = `Outside active hours · next at ${day} ${hhmm(s.nextAt)}`;
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
  renderChallenges(withPeriods(profile, now));
}

function challengeProgress(id, d) {
  const table = {
    variety: [d.areas.length, 3, "areas"],
    high_five: [d.breaks, 5, "breaks"],
    clean_form: [d.done.includes(id) ? 1 : 0, 1, "break with 90+ form"],
    early_mover: [d.done.includes(id) ? 1 : 0, 1, "break before 10:00"],
    no_excuses: [d.run, 3, "in a row, no skips"],
  };
  return table[id];
}

function challengeRow(name, bonus, [have, need, unit], done) {
  const li = document.createElement("li");
  li.classList.toggle("done", done);
  const title = document.createElement("span");
  title.textContent = `${done ? "✓ " : ""}${name}`;
  const meta = document.createElement("span");
  meta.className = "muted";
  meta.textContent = `${Math.min(have, need)}/${need} ${unit} · +${bonus}`;
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("span");
  fill.style.width = `${Math.min(1, have / need) * 100}%`;
  bar.append(fill);
  li.append(title, meta, bar);
  return li;
}

function renderChallenges(p) {
  const d = p.daily;
  const w = p.weekly;
  const rows = d.ids.map((id) => {
    const c = DAILY_POOL.find((x) => x.id === id);
    return challengeRow(c.name, c.bonus, challengeProgress(id, d), d.done.includes(id));
  });
  rows.push(challengeRow(`${w.area} week`, WEEKLY.bonus, [w.count, WEEKLY.target, `${w.area} exercises`], w.done));
  $("challengeRows").replaceChildren(...rows);
  $("badges").replaceChildren(
    ...p.badges.map((id) => {
      const el = document.createElement("span");
      el.textContent = badgeLabel(id);
      return el;
    }),
  );
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

initTheme();
chrome.storage.onChanged.addListener(render);
setInterval(render, 30_000);
render();
renderBoard();
