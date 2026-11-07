import { getSettings, getProfile, getSchedule, readLog, getActivity } from "./lib/store.js";
import { LEVELS, levelFor, dayKey } from "./lib/xp.js";
import { upcoming, isActive } from "./lib/schedule.js";
import { fetchBoard, submitScore } from "./lib/leaderboard.js";
import { DAILY_POOL, WEEKLY, withPeriods } from "./lib/challenges.js";
import { badgeLabel, challengeIcon } from "./lib/badges.js";
import { initTheme } from "./lib/themes.js";
import { heatmapWeeks, activityTotals, backfillActivity } from "./lib/activity.js";
import { initLang, t, localeFor, levelName, areaName, nameText } from "./lib/i18n.js";
import { getBusy } from "./lib/calendar-client.js";
import { nextMeeting } from "./lib/calendar.js";

const lang = await initLang();
const $ = (id) => document.getElementById(id);
const hhmm = (at) => new Date(at).toLocaleTimeString(localeFor(lang), { hour: "2-digit", minute: "2-digit" });

let paused = false;

async function render() {
  const [settings, profile, s, log] = await Promise.all([getSettings(), getProfile(), getSchedule(), readLog()]);
  const now = Date.now();
  const lv = levelFor(profile.xp);
  $("levelName").textContent = t(lang, "level", { n: lv.level, name: levelName(lang, lv.level, lv.name) });
  $("meName").textContent = settings.name || t(lang, "you");
  drawAvatar($("meAvatar"), settings.avatar);
  $("levelXp").textContent = lv.next ? t(lang, "xpOf", { xp: profile.xp, next: lv.next }) : t(lang, "xpMax", { xp: profile.xp });
  $("levelBar").style.width = `${lv.progress * 100}%`;

  $("setup").hidden = settings.setupDone;
  $("nextCard").hidden = !settings.setupDone;
  paused = s.pausedUntil > now;
  $("pause").textContent = t(lang, paused ? "resume" : "pause");
  if (paused) {
    $("nextText").textContent = t(lang, "pausedUntil", { time: hhmm(s.pausedUntil) });
  } else if (s.nextAt && !isActive(now, settings)) {
    const day = new Date(s.nextAt).toLocaleDateString(localeFor(lang), { weekday: "short" });
    $("nextText").textContent = t(lang, "outsideHours", { day, time: hhmm(s.nextAt) });
  } else if (s.nextAt) {
    const mins = Math.max(0, Math.ceil((s.nextAt - now) / 60_000));
    $("nextText").textContent = t(lang, "nextAt", { time: hhmm(s.nextAt), n: mins });
  } else {
    $("nextText").textContent = t(lang, "notScheduled");
  }
  const meeting = nextMeeting(await getBusy(now), now);
  $("nextMeeting").hidden = !meeting;
  if (meeting) $("nextMeeting").textContent = t(lang, "nextMeeting", { time: hhmm(meeting.start) });
  $("shifted").hidden = !(s.shiftedBy > 0 && s.nextAt && !paused);
  if (s.shiftedBy > 0 && s.nextAt) {
    $("shifted").textContent = t(lang, "shifted", { n: s.shiftedBy, times: upcoming(s, settings.intervalMin, 3).map(hhmm).join(" · ") });
  }

  const today = dayKey(now);
  $("todayDone").textContent = log.filter((b) => dayKey(b.at) === today).length;
  $("skips").textContent = s.skipsInRow ?? 0;
  $("streak").textContent = profile.streak;
  renderChallenges(withPeriods(profile, now));
  renderActivity((await getActivity()) ?? backfillActivity(log), settings, now);
}

const HEAT_WEEKS = 20;
const dayLabel = (at) => new Date(at).toLocaleDateString(localeFor(lang), { weekday: "short", month: "short", day: "numeric" });

function renderActivity(activity, settings, now) {
  const weeks = heatmapWeeks(activity, now, HEAT_WEEKS, settings.workdays);
  $("heatmap").replaceChildren(
    ...weeks.flat().map((c) => {
      const el = document.createElement("i");
      el.className = `cell l${c.level}${c.offday ? " offday" : ""}${c.future ? " future" : ""}`;
      el.title = t(lang, c.breaks === 1 ? "cellTipOne" : "cellTip", { date: dayLabel(c.at), n: c.breaks, xp: c.xp });
      return el;
    }),
  );
  const months = weeks.map((w, i) => {
    const el = document.createElement("span");
    const m = new Date(w[0].at).getMonth();
    const changed = i === 0 ? weeks.slice(1, 3).every((x) => new Date(x[0].at).getMonth() === m) : new Date(weeks[i - 1][0].at).getMonth() !== m;
    el.textContent = changed ? new Date(w[0].at).toLocaleDateString(localeFor(lang), { month: "short" }) : "";
    return el;
  });
  $("heatMonths").replaceChildren(...months);
  const totals = activityTotals(activity, now, HEAT_WEEKS);
  $("activityTotal").textContent = t(lang, "activityTotal", { breaks: totals.breaks, days: totals.activeDays });
}

function challengeProgress(id, d) {
  const table = {
    variety: [d.areas.length, 3, t(lang, "unitAreas")],
    high_five: [d.breaks, 5, t(lang, "unitBreaks")],
    clean_form: [d.done.includes(id) ? 1 : 0, 1, t(lang, "unitCleanForm")],
    early_mover: [d.done.includes(id) ? 1 : 0, 1, t(lang, "unitEarly")],
    no_excuses: [d.run, 3, t(lang, "unitNoSkips")],
  };
  return table[id];
}

function challengeTile(id, name, bonus, [have, need, unit], done, wide = false) {
  const tile = document.createElement("div");
  tile.className = `tile${done ? " done" : ""}${wide ? " wide" : ""}`;
  const shown = Math.min(have, need);
  tile.title = `${name} · ${shown}/${need} ${unit} · +${bonus}`;
  const icon = document.createElement("span");
  icon.className = "tile-icon";
  icon.textContent = challengeIcon(id);
  const label = document.createElement("span");
  label.className = "tile-name";
  label.textContent = name;
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("span");
  fill.style.width = `${Math.min(1, have / need) * 100}%`;
  bar.append(fill);
  const foot = document.createElement("span");
  foot.className = "tile-foot";
  const count = document.createElement("span");
  count.textContent = `${shown}/${need}`;
  const reward = document.createElement("b");
  reward.textContent = `+${bonus}`;
  foot.append(count, reward);
  tile.append(icon, label, bar, foot);
  if (done) {
    const check = document.createElement("span");
    check.className = "tile-check";
    check.textContent = "✓";
    tile.append(check);
  }
  return tile;
}

function renderChallenges(p) {
  const d = p.daily;
  const w = p.weekly;
  const tiles = d.ids.map((id) => {
    const c = DAILY_POOL.find((x) => x.id === id);
    return challengeTile(id, nameText(lang, `challenge.${id}`, c.name), c.bonus, challengeProgress(id, d), d.done.includes(id));
  });
  const area = areaName(lang, w.area);
  tiles.push(challengeTile("weekly", t(lang, "areaWeek", { area }), WEEKLY.bonus, [w.count, WEEKLY.target, t(lang, "unitAreaExercises", { area })], w.done, true));
  $("challengeTiles").replaceChildren(...tiles);
  $("badges").replaceChildren(
    ...p.badges.map((id) => {
      const el = document.createElement("span");
      el.textContent = badgeLabel(id, lang);
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

function drawAvatar(canvas, key) {
  if (canvas.dataset.key === key) return;
  canvas.dataset.key = key;
  Avatar.drawThumb(canvas, Object.hasOwn(Avatar.CHARACTERS, key) ? key : "bunny");
}

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
  sub.textContent = levelName(lang, r.level, LEVELS[r.level - 1]?.name ?? "");
  who.append(sub);
  const pts = document.createElement("span");
  pts.className = "pts";
  pts.textContent = `${r.xp} XP · 🔥${r.streak}`;
  const face = document.createElement("canvas");
  face.width = 56;
  face.height = 70;
  face.setAttribute("aria-hidden", "true");
  drawAvatar(face, r.avatar);
  li.append(rank, face, who, pts);
  return li;
}

async function renderBoard() {
  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  const rows = $("boardRows");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.period === period));
  if (settings.mode !== "competitive") {
    rows.replaceChildren();
    $("boardMsg").textContent = t(lang, "boardJoin", { company: settings.company || t(lang, "yourCompany") });
    return;
  }
  $("boardMsg").textContent = t(lang, "loading");
  await submitScore(profile, settings);
  const board = await fetchBoard(settings.company, period, profile.playerId);
  if (!board) {
    rows.replaceChildren();
    $("boardMsg").textContent = t(lang, "boardUnavailable");
    return;
  }
  rows.replaceChildren(...board.map(boardRow));
  $("boardMsg").textContent = board.length ? "" : t(lang, "boardEmpty");
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
