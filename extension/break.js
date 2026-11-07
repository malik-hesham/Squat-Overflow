import { getSettings, getSchedule, getCatalog } from "./lib/store.js";
import { createPoseClient, fetchCatalog } from "./lib/pose-client.js";
import { AREAS, BREAK_REPS, buildRoutine, swapMove, needsPositioning, featuredArea, areaImage } from "./lib/routine.js";
import { breakXp, levelFor } from "./lib/xp.js";
import { canSnooze, showWarning, warningHours } from "./lib/schedule.js";
import { badgeLabel } from "./lib/badges.js";
import { initTheme } from "./lib/themes.js";

const POSITION_TIMEOUT_MS = 15_000;
const YOUTUBE_ID = /^[\w-]{11}$/;
const CAMERA_HINT = "Put the camera side-on, 2–3 m away, with your whole body in frame.";

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  [
    "step", "xpTicker", "title", "bar", "warning", "warningTitle", "warnStart", "warnSnooze", "warnPause",
    "routine", "video", "canvas", "position", "fallback", "fallbackTitle", "fallbackText", "reps", "target",
    "lastScore", "cue", "areaImg", "howto", "hint", "demo", "swap", "summary", "confetti", "total", "lines", "levelUp",
    "levelName", "levelXp", "levelBar", "back", "actions", "done", "snooze", "skip",
  ].map((id) => [id, $(id)]),
);

const state = {
  catalog: [],
  moves: [],
  progress: [],
  i: 0,
  client: null,
  finished: false,
  positioning: false,
  positionTimer: 0,
};

const send = (msg) => chrome.runtime.sendMessage(msg);

async function closeWindow() {
  const win = await chrome.windows.getCurrent();
  chrome.windows.remove(win.id);
}

function currentResult() {
  const scores = state.progress.flatMap((p) => p.scores);
  return {
    scored: scores.length > 0,
    countedReps: state.progress.reduce((n, p) => n + p.reps, 0),
    targetReps: state.moves.reduce((n, m) => n + m.target, 0),
    scores,
    moves: state.moves.map((m, k) => ({ key: m.key, area: m.area, completed: state.progress[k].reps >= m.target })),
  };
}

function renderProgress() {
  const move = state.moves[state.i];
  const p = state.progress[state.i];
  if (!move) return;
  els.reps.textContent = p.reps;
  els.target.textContent = move.target;
  const total = state.moves.reduce((n, m) => n + m.target, 0);
  const done = state.progress.reduce((n, q) => n + q.reps, 0);
  els.bar.style.width = `${(100 * done) / total}%`;
  els.xpTicker.textContent = `+${breakXp(currentResult())} XP`;
}

function showMove(i) {
  state.i = i;
  const move = state.moves[i];
  document.title = `${move.area} | ${move.label}`;
  els.title.textContent = `${move.area} | ${move.label}`;
  els.step.textContent = `Exercise ${i + 1} / ${state.moves.length}`;
  els.howto.textContent = move.how_to;
  els.areaImg.src = areaImage(move.area);
  els.areaImg.alt = `${move.area} muscles`;
  els.hint.hidden = move.camera !== "side";
  els.hint.textContent = CAMERA_HINT;
  els.demo.hidden = !(move.demo && YOUTUBE_ID.test(move.demo.youtube_id) && navigator.onLine);
  if (!els.demo.hidden) els.demo.textContent = `▶ Watch demo (${move.demo.seconds}s)`;
  els.swap.hidden = !swapMove(state.catalog, state.moves, i);
  els.lastScore.hidden = true;
  els.cue.hidden = true;
  state.client?.setExercise(move.key);
  clearTimeout(state.positionTimer);
  state.positioning = needsPositioning(move) && els.fallback.hidden && state.client !== null;
  els.position.hidden = !state.positioning;
  if (state.positioning) state.positionTimer = setTimeout(endPositioning, POSITION_TIMEOUT_MS);
  renderProgress();
}

function endPositioning() {
  clearTimeout(state.positionTimer);
  state.positioning = false;
  els.position.hidden = true;
}

function showCue(text, good) {
  els.cue.textContent = text;
  els.cue.classList.toggle("good", good);
  els.cue.hidden = !text;
}

function onFrame(msg) {
  if (state.finished) return;
  if (state.positioning && !msg.feedback.some((f) => f.code === "not_visible")) endPositioning();
  const move = state.moves[state.i];
  const p = state.progress[state.i];
  if (msg.rep_event) {
    const score = msg.rep_event.score;
    p.scores.push(score);
    els.lastScore.textContent = `Form ${score}`;
    els.lastScore.hidden = false;
    const issue = msg.rep_event.issue_text?.[0];
    showCue(issue ?? (score >= 85 ? "Great form!" : ""), !issue);
  }
  p.reps = Math.min(msg.summary.reps, move.target);
  renderProgress();
  if (p.reps >= move.target) {
    if (state.i + 1 < state.moves.length) showMove(state.i + 1);
    else finish();
  }
}

function onStatus(status) {
  if (status !== "offline" && status !== "camera-denied") return;
  if (state.finished) return;
  endPositioning();
  els.fallback.hidden = false;
  els.fallbackTitle.textContent = status === "offline" ? "Coach offline" : "Camera unavailable";
  els.fallbackText.textContent =
    status === "offline"
      ? "Can't reach the pose server. Follow the instructions below and press Done when finished."
      : "Camera access is blocked or missing. Follow the instructions below and press Done when finished.";
}

function confetti() {
  const colors = ["#3ddc97", "#ffd166", "#5aa9ff", "#ff6b6b", "#c792ea"];
  const pieces = Array.from({ length: 48 }, (_, k) => {
    const el = document.createElement("i");
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = colors[k % colors.length];
    el.style.animationDelay = `${Math.random() * 0.6}s`;
    return el;
  });
  els.confetti.replaceChildren(...pieces);
}

function countUp(el, to) {
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 900);
    el.textContent = Math.round(to * k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderLevel(xp) {
  const lv = levelFor(xp);
  els.levelName.textContent = `Lv ${lv.level} · ${lv.name}`;
  els.levelXp.textContent = lv.next ? `${xp} / ${lv.next} XP` : `${xp} XP · max level`;
  return lv.progress;
}

function showSummary({ breakdown, levelUp, newBadges = [], profile }) {
  els.routine.hidden = true;
  els.warning.hidden = true;
  els.actions.hidden = true;
  els.summary.hidden = false;
  document.title = "Break complete";
  els.title.textContent = "Nice work!";
  els.step.textContent = "Break complete";
  const lines = [
    ["Break", breakdown.breakXp],
    ["First break of the day", breakdown.firstBreak],
    ["Streak bonus", breakdown.streak],
    ...breakdown.challenges.map((c) => [`Challenge: ${c.name}`, c.bonus]),
  ].filter(([, v]) => v > 0);
  if (!lines.length) lines.push(["No reps counted this time", 0]);
  for (const id of newBadges) lines.push([`New badge: ${badgeLabel(id)}`, null]);
  els.lines.replaceChildren(
    ...lines.map(([label, v]) => {
      const li = document.createElement("li");
      li.append(label);
      if (v !== null) {
        const b = document.createElement("b");
        b.textContent = `+${v}`;
        li.append(b);
      }
      return li;
    }),
  );
  countUp(els.total, breakdown.total);
  const before = levelFor(profile.xp - breakdown.total);
  els.levelBar.style.width = `${(levelUp ? 0 : before.progress) * 100}%`;
  const progress = renderLevel(profile.xp);
  requestAnimationFrame(() => requestAnimationFrame(() => (els.levelBar.style.width = `${progress * 100}%`)));
  if (levelUp) {
    els.levelUp.textContent = `You're now a ${levelUp.name}!`;
    els.levelUp.hidden = false;
    confetti();
  }
}

async function finish() {
  if (state.finished) return;
  state.finished = true;
  endPositioning();
  state.client?.stop();
  els.done.disabled = els.snooze.disabled = els.skip.disabled = true;
  const res = await send({ type: "break-action", action: "done", result: currentResult(), lastKey: state.moves.at(-1)?.key ?? null });
  if (res?.ok) showSummary(res);
  else closeWindow();
}

async function leave(action) {
  if (state.finished) return;
  state.finished = true;
  state.client?.stop();
  await send({ type: "break-action", action });
  closeWindow();
}

async function openDemo() {
  const demo = state.moves[state.i]?.demo;
  if (!demo || !YOUTUBE_ID.test(demo.youtube_id)) return;
  await chrome.windows.create({ url: `https://www.youtube.com/watch?v=${demo.youtube_id}`, type: "popup", width: 480, height: 400 });
}

function swap(ev) {
  ev.preventDefault();
  const m = swapMove(state.catalog, state.moves, state.i);
  if (!m) return;
  state.moves[state.i] = m;
  state.progress[state.i] = { reps: 0, scores: [] };
  showMove(state.i);
}

async function startRoutine() {
  els.warning.hidden = true;
  els.routine.hidden = false;
  els.actions.hidden = false;
  if (!state.moves.length) {
    onStatus("offline");
    els.title.textContent = "Time to move";
    els.howto.textContent = "Stand up, roll your shoulders, stretch your neck side to side and walk around for two minutes.";
    els.swap.hidden = true;
    return;
  }
  showMove(0);
  const settings = await getSettings();
  state.client = createPoseClient({
    serverUrl: settings.serverUrl,
    video: els.video,
    canvas: els.canvas,
    privacy: settings.privacy,
    onFrame,
    onStatus,
  });
  if (await state.client.start()) showMove(state.i);
}

async function init() {
  initTheme();
  const [settings, schedule] = await Promise.all([getSettings(), getSchedule()]);
  let catalog = await fetchCatalog(settings.serverUrl);
  if (!catalog.length) catalog = await getCatalog();
  state.catalog = catalog;
  state.moves = buildRoutine(catalog, {
    areas: settings.areas.length ? settings.areas : AREAS.slice(0, 2),
    featured: featuredArea(Date.now()),
    lastKey: schedule.lastKey,
    n: schedule.breakCount,
  });
  state.progress = state.moves.map(() => ({ reps: 0, scores: [] }));
  els.target.textContent = BREAK_REPS;

  els.done.addEventListener("click", finish);
  els.snooze.addEventListener("click", () => leave("snooze"));
  els.skip.addEventListener("click", () => leave("skip"));
  els.back.addEventListener("click", closeWindow);
  els.demo.addEventListener("click", openDemo);
  els.swap.addEventListener("click", swap);

  const manual = location.hash.startsWith("#manual");
  if (!canSnooze(schedule)) {
    els.snooze.disabled = els.warnSnooze.disabled = true;
    els.snooze.textContent = els.warnSnooze.textContent = "Snoozed twice, time to move";
  }
  if (!manual && showWarning(schedule)) {
    showWarningScreen(schedule, settings.intervalMin);
    return;
  }
  await startRoutine();
}

function showWarningScreen(schedule, intervalMin) {
  els.routine.hidden = true;
  els.actions.hidden = true;
  els.warning.hidden = false;
  const text = `~${warningHours(schedule.skipsInRow, intervalMin)} hours without moving`;
  els.warningTitle.textContent = text;
  els.title.textContent = "Time to move";
  els.step.textContent = `${schedule.skipsInRow} breaks skipped in a row`;
  document.title = text;
  els.warnStart.addEventListener("click", startRoutine);
  els.warnSnooze.addEventListener("click", () => leave("snooze"));
  els.warnPause.addEventListener("click", () => leave("pause"));
}

init();
