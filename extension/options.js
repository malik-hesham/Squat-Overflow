import { getSettings, saveSettings, getProfile } from "./lib/store.js";
import { AREAS, areaImage } from "./lib/routine.js";
import { scheduleSettingsChanged } from "./lib/schedule.js";
import { THEMES, themeId, applyTheme, initTheme } from "./lib/themes.js";

const PRESETS = ["30", "45", "60", "90", "120"];
const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];
const COMPANY_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

const $ = (id) => document.getElementById(id);
const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const checkedValue = (name) => radios(name).find((r) => r.checked)?.value;

let initial = null;

function chip(container, value, label, checked) {
  const el = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.checked = checked;
  el.append(input, ` ${label}`);
  container.append(el);
}

function areaCard(area, checked) {
  const el = document.createElement("label");
  el.className = "area-card";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = area;
  input.checked = checked;
  const img = document.createElement("img");
  img.src = areaImage(area);
  img.alt = "";
  const name = document.createElement("span");
  name.textContent = area;
  el.append(input, img, name);
  $("areas").append(el);
}

function read() {
  const preset = checkedValue("interval");
  const mode = checkedValue("mode");
  return {
    intervalMin: preset === "custom" ? Number($("customMin").value) : Number(preset),
    areas: [...$("areas").querySelectorAll("input:checked")].map((i) => i.value),
    activeStart: $("activeStart").value,
    activeEnd: $("activeEnd").value,
    workdays: [...$("workdays").querySelectorAll("input:checked")].map((i) => Number(i.value)),
    autoPause: $("autoPause").checked,
    privacy: $("privacy").checked,
    mode,
    name: $("name").value.trim(),
    company: $("company").value.trim().toLowerCase(),
    serverUrl: $("serverUrl").value.trim(),
  };
}

function problem(s) {
  if (!Number.isInteger(s.intervalMin) || s.intervalMin < 1 || s.intervalMin > 240) return "Pick an interval between 1 and 240 minutes.";
  if (!s.areas.length) return "Pick at least one area.";
  if (!s.workdays.length) return "Pick at least one workday.";
  if (!s.activeStart || !s.activeEnd || s.activeStart >= s.activeEnd) return "Active hours must start before they end.";
  if (s.mode === "competitive") {
    if (!s.name || s.name.length > 40) return "Enter a display name (up to 40 characters).";
    if (!COMPANY_RE.test(s.company)) return "Enter your company's email domain, e.g. leadliaison.com.";
  }
  if (!/^wss?:\/\//.test(s.serverUrl)) return "Pose server URL must start with ws:// or wss://.";
  return "";
}

function refresh() {
  $("customWrap").hidden = checkedValue("interval") !== "custom";
  $("competitive").hidden = checkedValue("mode") !== "competitive";
  const err = problem(read());
  $("error").textContent = initial.setupDone ? err : "";
  $("save").disabled = Boolean(err);
  $("saved").hidden = true;
}

async function save() {
  const next = read();
  if (problem(next)) return;
  await saveSettings({ ...next, setupDone: true });
  await chrome.runtime
    .sendMessage({ type: "settings-saved", scheduleChanged: scheduleSettingsChanged(initial, next) })
    .catch(() => {});
  if (initial.mode === "competitive" && next.mode === "personal") {
    await chrome.runtime.sendMessage({ type: "left-board" }).catch(() => {});
  }
  const firstRun = !initial.setupDone;
  initial = { ...initial, ...next, setupDone: true };
  if (firstRun) render();
  $("saved").hidden = false;
}

function render() {
  const first = !initial.setupDone;
  $("heading").textContent = first ? "Welcome to StandUp Break" : "StandUp Break settings";
  $("intro").hidden = !first;
  $("save").textContent = first ? "Get started" : "Save";
}

function renderThemes(current) {
  $("themes").replaceChildren(
    ...THEMES.map((t) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "theme-card";
      card.setAttribute("aria-pressed", String(t.id === current));
      const dots = document.createElement("span");
      dots.className = "dots";
      dots.append(
        ...t.swatch.map((color) => {
          const dot = document.createElement("span");
          dot.style.background = color;
          return dot;
        }),
      );
      card.append(dots, t.name);
      card.addEventListener("click", async () => {
        applyTheme(t.id);
        renderThemes(t.id);
        await saveSettings({ theme: t.id });
      });
      return card;
    }),
  );
}

async function init() {
  initTheme();
  initial = await getSettings();
  renderThemes(themeId(initial.theme));
  await getProfile();
  const preset = PRESETS.includes(String(initial.intervalMin)) ? String(initial.intervalMin) : "custom";
  radios("interval").forEach((r) => (r.checked = r.value === preset));
  $("customMin").value = initial.intervalMin;
  AREAS.forEach((a) => areaCard(a, initial.areas.includes(a)));
  DAYS.forEach(([d, label]) => chip($("workdays"), d, label, initial.workdays.includes(d)));
  $("activeStart").value = initial.activeStart;
  $("activeEnd").value = initial.activeEnd;
  $("autoPause").checked = initial.autoPause;
  $("privacy").checked = initial.privacy;
  radios("mode").forEach((r) => (r.checked = r.value === initial.mode));
  $("name").value = initial.name;
  $("company").value = initial.company;
  $("serverUrl").value = initial.serverUrl;
  render();
  document.querySelector("main").addEventListener("input", refresh);
  document.querySelector("main").addEventListener("change", refresh);
  $("save").addEventListener("click", save);
  refresh();
}

init();
