import { getSettings, saveSettings, getSchedule, getCatalog, getProfile, getActivity, readLog, getMemeTurns, setMemeTurns } from "./lib/store.js";
import { createPoseClient, fetchCatalog } from "./lib/pose-client.js";
import { AREAS, BREAK_REPS, buildRoutine, swapMove, needsPositioning, nextOpenMove } from "./lib/routine.js";
import { breakXp, levelFor } from "./lib/xp.js";
import { canSnooze, showWarning, warningHours } from "./lib/schedule.js";
import { badgeLabel } from "./lib/badges.js";
import { initTheme } from "./lib/themes.js";
import { backfillActivity } from "./lib/activity.js";
import { avatarFitness, fitnessCaption } from "./lib/fitness.js";
import { initLang, t, exerciseText, areaName, levelName, issueText, nameText } from "./lib/i18n.js";
import { Avatar } from "./avatar.js";
import { createMemePlayer, repMarks } from "./lib/memes.js";

const POSITION_TIMEOUT_MS = 15_000;
const CAMERA_SLOW_MS = 6_000;
const YOUTUBE_ID = /^[\w-]{11}$/;

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  [
    "step", "xpTicker", "title", "bar", "warning", "warningTitle", "warnStart", "warnSnooze", "warnPause",
    "routine", "video", "canvas", "position", "fallback", "fallbackTitle", "fallbackText", "reps", "target",
    "lastScore", "cue", "howto", "hint", "demoPane", "demoFrame", "swap", "summary", "confetti", "total", "lines", "levelUp",
    "levelName", "levelXp", "levelBar", "back", "actions", "done", "snooze", "skip", "voice", "memes", "lookBtn", "lookName",
    "lookGrid", "lookThumb", "fitness", "area", "moves", "starting", "startingText",
  ].map((id) => [id, $(id)]),
);

const state = {
  lang: "en",
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
  sounds: null, // meme player, see lib/memes.js
  meme: Promise.resolve(), // the clips queued now; voice cues wait for them
  speech: Promise.resolve(), // voice cues waiting their turn
  repMarks: [], // total-rep counts where the rep clips play
  repMemes: 0, // rep clips played so far
};

const send = (msg) => chrome.runtime.sendMessage(msg);

function speak(text) {
  if (!state.settings?.voice || !text || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  if (state.lang === "ar") u.lang = "ar-SA";
  const prev = state.speech;
  state.speech = (async () => {
    await prev; // keep cues in the order they were asked for
    await memesDone(); // and never talk over a meme clip
    if (!state.settings.voice) return; // switched off while waiting
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  })();
}

// Resolves once no meme clip is playing or queued, counting clips queued while waiting.
async function memesDone() {
  let clips;
  do await (clips = state.meme);
  while (clips !== state.meme);
}

// kind: a MEMES group in lib/memes.js.
function meme(kind) {
  if (state.settings?.memes && state.sounds) state.meme = state.sounds.play(kind);
}

function announce(i) {
  const move = state.moves[i];
  if (move) speak(t(state.lang, i ? "sayNext" : "sayMove", { label: move.label, n: move.target }));
}

// "camera" (no privacy), "blur", or an Avatar.CHARACTERS key.
function lookKey() {
  const { privacy, privacyStyle } = state.settings;
  if (!privacy) return "camera";
  return Object.hasOwn(Avatar.CHARACTERS, privacyStyle) ? privacyStyle : "blur";
}

function lookOptions() {
  return [
    ["camera", t(state.lang, "camera")],
    ["blur", t(state.lang, "lookBlur")],
    ...Object.entries(Avatar.CHARACTERS).map(([k, c]) => [k, nameText(state.lang, `avatar.${k}`, c.label)]),
  ];
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

async function onMemesChange() {
  state.settings.memes = els.memes.checked;
  await saveSettings({ memes: els.memes.checked });
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
  document.title = `${areaName(state.lang, move.area)} | ${move.label}`;
  els.title.textContent = move.label;
  els.area.textContent = areaName(state.lang, move.area);
  els.area.hidden = false;
  els.step.textContent = t(state.lang, "exerciseStep", { i: i + 1, n: state.moves.length });
  els.howto.textContent = move.how_to;
  els.hint.hidden = move.camera !== "side";
  els.hint.textContent = t(state.lang, "cameraHint");
  showDemo(move);
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
  if (els.moves.children.length !== state.moves.length) {
    els.moves.replaceChildren(
      ...state.moves.map((_, k) => {
        const tab = document.createElement("button");
        tab.type = "button";
        const name = document.createElement("span");
        name.className = "name";
        const count = document.createElement("span");
        count.className = "count";
        tab.append(name, count);
        tab.addEventListener("click", () => selectMove(k));
        return tab;
      }),
    );
  }
  state.moves.forEach((m, k) => {
    const tab = els.moves.children[k];
    const reps = state.progress[k].reps;
    const done = reps >= m.target;
    tab.classList.toggle("done", done);
    tab.setAttribute("aria-current", String(k === state.i));
    tab.title = `${areaName(state.lang, m.area)} | ${m.label}`;
    tab.querySelector(".name").textContent = m.label;
    tab.querySelector(".count").textContent = done ? "✓" : `${reps}/${m.target}`;
  });
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
  els.startingText.textContent = t(state.lang, "framesLocal");
  state.startingTimer = setTimeout(() => {
    els.startingText.textContent = t(state.lang, "cameraSlow");
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
  // Rep clips are spread over the whole break; on the last rep, the Done clip queues after it.
  if (state.progress.reduce((n, q) => n + q.reps, 0) >= (state.repMarks[state.repMemes] ?? Infinity)) {
    state.repMemes++;
    meme("reps");
  }
  if (msg.rep_event) {
    const { score, partial } = msg.rep_event;
    p.scores.push(score);
    els.lastScore.textContent = t(state.lang, "form", { score });
    els.lastScore.hidden = false;
    const code = msg.rep_event.issues?.[0];
    const english = msg.rep_event.issue_text?.[0];
    const issue = english === undefined ? undefined : issueText(state.lang, code, english);
    showCue(issue ?? (score >= 85 ? t(state.lang, "greatForm") : ""), !issue);
    if (!partial) state.client?.celebrate(!issue);
    speak(partial ? t(state.lang, "goDeeper") : (issue ?? String(p.reps)));
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
  els.demoPane.hidden = true;
  els.demoFrame.removeAttribute("src");
  els.fallbackTitle.textContent = t(state.lang, status === "offline" ? "coachOffline" : "cameraUnavailable");
  els.fallbackText.textContent = t(state.lang, status === "offline" ? "offlineText" : "deniedText");
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
  els.levelName.textContent = t(state.lang, "level", { n: lv.level, name: levelName(state.lang, lv.level, lv.name) });
  els.levelXp.textContent = lv.next ? t(state.lang, "xpOf", { xp, next: lv.next }) : t(state.lang, "xpMaxLevel", { xp });
  return lv.progress;
}

function showSummary({ breakdown, levelUp, newBadges = [], profile }) {
  els.routine.hidden = true;
  els.warning.hidden = true;
  els.actions.hidden = true;
  els.summary.hidden = false;
  document.title = t(state.lang, "breakComplete");
  els.area.hidden = els.moves.hidden = true;
  els.title.textContent = t(state.lang, "niceWork");
  els.step.textContent = t(state.lang, "breakComplete");
  const lines = [
    [t(state.lang, "break"), breakdown.breakXp],
    [t(state.lang, "firstBreak"), breakdown.firstBreak],
    [t(state.lang, "streakBonus"), breakdown.streak],
    ...breakdown.challenges.map((c) => [t(state.lang, "challengeLine", { name: challengeName(c, profile) }), c.bonus]),
  ].filter(([, v]) => v > 0);
  if (!lines.length) lines.push([t(state.lang, "noReps"), 0]);
  for (const id of newBadges) lines.push([t(state.lang, "newBadge", { name: badgeLabel(id, state.lang) }), null]);
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
    els.levelUp.textContent = t(state.lang, "levelUp", { name: levelName(state.lang, levelUp.to, levelUp.name) });
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
  const result = currentResult();
  meme(result.scored ? "done" : "unscored");
  speak(t(state.lang, "sayDone"));
  const res = await send({ type: "break-action", action: "done", result, lastKey: state.moves.at(-1)?.key ?? null });
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

function demoUrl(move) {
  if (!move.demo || !YOUTUBE_ID.test(move.demo.youtube_id) || !navigator.onLine || !els.fallback.hidden) return null;
  const origin = new URL(state.settings.serverUrl.replace(/^ws/, "http")).origin;
  return `${origin}/embed/${move.demo.youtube_id}`;
}

function showDemo(move) {
  const url = demoUrl(move);
  els.demoPane.hidden = !url;
  if (url && els.demoFrame.getAttribute("src") !== url) els.demoFrame.src = url;
  if (!url) els.demoFrame.removeAttribute("src");
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

// `withMeme`: the user asked for this break ("Break now"), so play a clip.
async function startRoutine(withMeme = false) {
  if (withMeme) meme("start");
  els.warning.hidden = true;
  els.routine.hidden = false;
  els.actions.hidden = false;
  if (!state.moves.length) {
    onStatus("offline");
    els.title.textContent = t(state.lang, "timeToMove");
    els.howto.textContent = t(state.lang, "manualHowto");
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
  state.lang = await initLang();
  const [settings, schedule, memeTurns] = await Promise.all([getSettings(), getSchedule(), getMemeTurns()]);
  state.settings = settings;
  state.sounds = createMemePlayer(memeTurns, setMemeTurns);
  state.fitness = await loadFitness(settings.workdays);
  let catalog = await fetchCatalog(settings.serverUrl);
  if (!catalog.length) catalog = await getCatalog();
  state.catalog = catalog.map((e) => ({
    ...e,
    label: exerciseText(state.lang, e.key, "label", e.label),
    how_to: exerciseText(state.lang, e.key, "how_to", e.how_to),
  }));
  state.moves = buildRoutine(state.catalog, {
    areas: settings.areas.length ? settings.areas : AREAS.slice(0, 2),
    lastKey: schedule.lastKey,
    n: schedule.breakCount,
  });
  state.progress = state.moves.map(() => ({ reps: 0, scores: [] }));
  state.repMarks = repMarks(state.moves.reduce((n, m) => n + m.target, 0));
  els.target.textContent = BREAK_REPS;

  els.done.addEventListener("click", finish);
  els.snooze.addEventListener("click", () => leave("snooze"));
  els.skip.addEventListener("click", () => leave("skip"));
  els.back.addEventListener("click", closeWindow);
  els.swap.addEventListener("click", swap);
  els.voice.checked = settings.voice;
  els.voice.addEventListener("change", onVoiceChange);
  els.memes.checked = settings.memes;
  els.memes.addEventListener("change", onMemesChange);
  els.lookBtn.addEventListener("click", () => toggleLooks());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !els.lookGrid.hidden) toggleLooks(false);
  });
  els.lookGrid.addEventListener("change", onLookChange);
  renderLooks();

  const manual = location.hash.startsWith("#manual");
  if (!canSnooze(schedule)) {
    els.snooze.disabled = els.warnSnooze.disabled = true;
    els.snooze.textContent = els.warnSnooze.textContent = t(state.lang, "snoozedTwice");
  }
  if (!manual && showWarning(schedule)) {
    showWarningScreen(schedule, settings.intervalMin);
    return;
  }
  await startRoutine(manual);
}

function showWarningScreen(schedule, intervalMin) {
  els.routine.hidden = true;
  els.actions.hidden = true;
  els.warning.hidden = false;
  const text = t(state.lang, "warnTitle", { n: warningHours(schedule.skipsInRow, intervalMin) });
  els.warningTitle.textContent = text;
  els.title.textContent = t(state.lang, "timeToMove");
  els.area.hidden = true;
  els.step.textContent = t(state.lang, "skippedInRow", { n: schedule.skipsInRow });
  document.title = text;
  els.warnStart.addEventListener("click", () => startRoutine(true));
  els.warnSnooze.addEventListener("click", () => leave("snooze"));
  els.warnPause.addEventListener("click", () => leave("pause"));
}

function challengeName(c, profile) {
  if (c.id === "weekly") return t(state.lang, "areaWeek", { area: areaName(state.lang, profile.weekly?.area ?? "") });
  return nameText(state.lang, `challenge.${c.id}`, c.name);
}

init();
