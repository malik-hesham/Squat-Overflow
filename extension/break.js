import { getSettings, saveSettings, getSchedule, getCatalog, getProfile, getActivity, readLog } from "./lib/store.js";
import { createPoseClient, fetchCatalog } from "./lib/pose-client.js";
import { AREAS, BREAK_REPS, buildRoutine, swapMove, needsPositioning, featuredArea, nextOpenMove } from "./lib/routine.js";
import { breakXp, levelFor } from "./lib/xp.js";
import { canSnooze, showWarning, warningHours } from "./lib/schedule.js";
import { badgeLabel } from "./lib/badges.js";
import { initTheme } from "./lib/themes.js";
import { backfillActivity } from "./lib/activity.js";
import { avatarFitness, fitnessCaption } from "./lib/fitness.js";
import { Avatar } from "./avatar.js";

const POSITION_TIMEOUT_MS = 15_000;
const CAMERA_SLOW_MS = 6_000;
const YOUTUBE_ID = /^[\w-]{11}$/;
const CAMERA_HINT = "Put the camera side-on, 2–3 m away, with your whole body in frame.";

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  [
    "step", "xpTicker", "title", "bar", "warning", "warningTitle", "warnStart", "warnSnooze", "warnPause",
    "routine", "video", "canvas", "position", "fallback", "fallbackTitle", "fallbackText", "reps", "target",
    "lastScore", "cue", "howto", "hint", "demo", "swap", "summary", "confetti", "total", "lines", "levelUp",
    "levelName", "levelXp", "levelBar", "back", "actions", "done", "snooze", "skip", "voice", "lookBtn", "lookName",
    "lookGrid", "lookThumb", "fitness", "area", "moves", "starting", "startingText",
  ].map((id) => [id, $(id)]),
);

const state = {
  settings: null,
  catalog: [],
  moves: [],
  progress: [],
  i: 0,
  client: null,
  finished: false,
  positioning: false,
  positionTimer: 0,
  startingTimer: 0,
  fitness: null,
};

const send = (msg) => chrome.runtime.sendMessage(msg);

function speak(text) {
  if (!state.settings?.voice || !text || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

function announce(i) {
  const move = state.moves[i];
  if (move) speak(`${i ? "Next, " : ""}${move.label}. ${move.target} reps.`);
}

// "camera" (no privacy), "blur", or an Avatar.CHARACTERS key.
function lookKey() {
  const { privacy, privacyStyle } = state.settings;
  if (!privacy) return "camera";
  return Object.hasOwn(Avatar.CHARACTERS, privacyStyle) ? privacyStyle : "blur";
}

function lookOptions() {
  return [["camera", "Camera"], ["blur", "Blur"], ...Object.entries(Avatar.CHARACTERS).map(([k, c]) => [k, c.label])];
}

function drawCameraThumb(canvas) {
  const g = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#3a4650");
  bg.addColorStop(1, "#1d2328");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.font = `${Math.round(w / 2.4)}px system-ui`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("📷", w / 2, h / 2);
}

function drawLookThumb(canvas, key) {
  if (key === "camera") drawCameraThumb(canvas);
  else Avatar.drawThumb(canvas, key, state.fitness);
}

function renderLooks() {
  els.lookGrid.replaceChildren(
    ...lookOptions().map(([key, label]) => {
      const opt = document.createElement("label");
      opt.className = "look-opt";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "look";
      input.value = key;
      const thumb = document.createElement("canvas");
      thumb.width = 90;
      thumb.height = 120;
      thumb.setAttribute("aria-hidden", "true");
      drawLookThumb(thumb, key);
      const name = document.createElement("span");
      name.textContent = label;
      opt.append(input, thumb, name);
      return opt;
    }),
  );
  syncLook();
}

function syncLook() {
  const key = lookKey();
  for (const input of els.lookGrid.querySelectorAll("input")) input.checked = input.value === key;
  els.lookName.textContent = lookOptions().find(([k]) => k === key)[1];
  drawLookThumb(els.lookThumb, key);
  const character = Avatar.CHARACTERS[key];
  els.fitness.hidden = !character || !state.fitness;
  if (!els.fitness.hidden) els.fitness.textContent = fitnessCaption(state.fitness, character.label);
}

// How buff or droopy the character looks, from your level and recent breaks.
async function loadFitness(workdays) {
  const [profile, activity] = await Promise.all([getProfile(), getActivity()]);
  return avatarFitness(profile.xp, activity ?? backfillActivity(await readLog()), Date.now(), workdays);
}

async function onLookChange(ev) {
  if (ev.target.name !== "look") return;
  const key = ev.target.value;
  const patch = key === "camera" ? { privacy: false } : { privacy: true, privacyStyle: key };
  Object.assign(state.settings, patch);
  syncLook();
  state.client?.setLook({ privacy: state.settings.privacy, style: state.settings.privacyStyle });
  await saveSettings(patch);
}

function toggleLooks(open = els.lookGrid.hidden) {
  els.lookGrid.hidden = !open;
  els.lookBtn.setAttribute("aria-expanded", String(open));
}

async function onVoiceChange() {
  state.settings.voice = els.voice.checked;
  if (!els.voice.checked && "speechSynthesis" in window) speechSynthesis.cancel();
  else announce(state.i);
  await saveSettings({ voice: els.voice.checked });
}

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
  renderMoves();
}

function showMove(i) {
  state.i = i;
  const move = state.moves[i];
  state.progress[i].base = state.progress[i].reps;
  document.title = `${move.area} | ${move.label}`;
  els.title.textContent = move.label;
  els.area.textContent = move.area;
  els.area.hidden = false;
  els.step.textContent = `Exercise ${i + 1} of ${state.moves.length}`;
  els.howto.textContent = move.how_to;
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

function renderMoves() {
  els.moves.replaceChildren(
    ...state.moves.map((m, k) => {
      const tab = document.createElement("button");
      const reps = state.progress[k].reps;
      const done = reps >= m.target;
      tab.type = "button";
      tab.className = done ? "done" : "";
      tab.setAttribute("aria-current", String(k === state.i));
      tab.title = `${m.area} | ${m.label}`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = m.label;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = done ? "✓" : `${reps}/${m.target}`;
      tab.append(name, count);
      tab.addEventListener("click", () => selectMove(k));
      return tab;
    }),
  );
}

function selectMove(k) {
  if (state.finished || k === state.i) return;
  showMove(k);
  announce(k);
}

function setStarting(on) {
  clearTimeout(state.startingTimer);
  els.starting.hidden = !on;
  if (!on) return;
  els.startingText.textContent = "Frames stay on this computer.";
  state.startingTimer = setTimeout(() => {
    els.startingText.textContent =
      "Still waiting for a picture. Check that this browser is allowed to use the camera (on a Mac: System Settings › Privacy & Security › Camera).";
  }, CAMERA_SLOW_MS);
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
  const was = p.reps;
  p.reps = Math.min((p.base ?? 0) + msg.summary.reps, move.target);
  if (msg.rep_event) {
    const { score, partial } = msg.rep_event;
    p.scores.push(score);
    els.lastScore.textContent = `Form ${score}`;
    els.lastScore.hidden = false;
    const issue = msg.rep_event.issue_text?.[0];
    showCue(issue ?? (score >= 85 ? "Great form!" : ""), !issue);
    if (!partial) state.client?.celebrate(!issue);
    speak(partial ? "Go deeper" : (issue ?? String(p.reps)));
  }
  renderProgress();
  if (was < move.target && p.reps >= move.target) {
    const next = nextOpenMove(state.moves, state.progress, state.i);
    if (next === -1) finish();
    else {
      showMove(next);
      announce(next);
    }
  }
}

function onStatus(status) {
  if (status !== "offline" && status !== "camera-denied") return;
  if (state.finished) return;
  endPositioning();
  setStarting(false);
  els.lookBtn.hidden = els.lookGrid.hidden = true;
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
  els.area.hidden = els.moves.hidden = true;
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
  setStarting(false);
  state.client?.stop();
  els.done.disabled = els.snooze.disabled = els.skip.disabled = true;
  speak("Break done. Back to work!");
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
  announce(state.i);
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
  const { settings } = state;
  state.client = createPoseClient({
    serverUrl: settings.serverUrl,
    video: els.video,
    canvas: els.canvas,
    privacy: settings.privacy,
    style: settings.privacyStyle,
    avatars: Avatar,
    fitness: state.fitness,
    onFrame,
    onStatus,
  });
  setStarting(true);
  const started = await state.client.start();
  setStarting(false);
  if (started) showMove(state.i);
  announce(state.i);
}

async function init() {
  initTheme();
  const [settings, schedule] = await Promise.all([getSettings(), getSchedule()]);
  state.settings = settings;
  state.fitness = await loadFitness(settings.workdays);
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
  els.voice.checked = settings.voice;
  els.voice.addEventListener("change", onVoiceChange);
  els.lookBtn.addEventListener("click", () => toggleLooks());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !els.lookGrid.hidden) toggleLooks(false);
  });
  els.lookGrid.addEventListener("change", onLookChange);
  renderLooks();

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
  els.area.hidden = true;
  els.step.textContent = `${schedule.skipsInRow} breaks skipped in a row`;
  document.title = text;
  els.warnStart.addEventListener("click", startRoutine);
  els.warnSnooze.addEventListener("click", () => leave("snooze"));
  els.warnPause.addEventListener("click", () => leave("pause"));
}

init();
