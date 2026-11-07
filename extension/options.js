import { getSettings, saveSettings, getProfile } from "./lib/store.js";
import { Avatar } from "./avatar.js";
import { AREAS } from "./lib/routine.js";
import { scheduleSettingsChanged, weekOrder } from "./lib/schedule.js";
import { THEMES, themeId, applyTheme, initTheme } from "./lib/themes.js";
import { LANGS, initLang, applyLang, resolveLang, t, areaName, nameText } from "./lib/i18n.js";
import { calendarState, connectCalendar, disconnectCalendar } from "./lib/calendar-client.js";
import { getSession, signIn, signOut } from "./lib/session.js";
import { companyFromEmail } from "./lib/auth.js";

const PRESETS = ["30", "45", "60", "90", "120"];

const $ = (id) => document.getElementById(id);
const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const checkedValue = (name) => radios(name).find((r) => r.checked)?.value;

let initial = null;
let lang = "en";
let session = null;
let skipped = false;

function chip(container, value, label, checked, hint = "") {
  const el = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.checked = checked;
  if (hint) {
    const text = document.createElement("span");
    const name = document.createElement("strong");
    const small = document.createElement("small");
    name.textContent = label;
    small.textContent = hint;
    text.append(name, small);
    el.append(input, text);
  } else {
    el.append(input, ` ${label}`);
  }
  container.append(el);
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
    weekStart: Number($("weekStart").value),
    autoPause: $("autoPause").checked,
    privacy: $("privacy").checked,
    mode,
    name: $("name").value.trim(),
    serverUrl: $("serverUrl").value.trim(),
  };
}

function problem(s) {
  if (!Number.isInteger(s.intervalMin) || s.intervalMin < 1 || s.intervalMin > 240) return t(lang, "errInterval");
  if (!s.areas.length) return t(lang, "errAreas");
  if (!s.workdays.length) return t(lang, "errWorkdays");
  if (!s.activeStart || !s.activeEnd || s.activeStart >= s.activeEnd) return t(lang, "errHours");
  if (s.mode === "competitive") {
    if (!s.name || s.name.length > 40) return t(lang, "errName");
    if (!companyFromEmail(session?.user?.email)) return t(lang, "errCompany");
  }
  if (!/^wss?:\/\//.test(s.serverUrl)) return t(lang, "errServer");
  return "";
}

function refresh() {
  $("customWrap").hidden = checkedValue("interval") !== "custom";
  $("modeHint").textContent = t(lang, checkedValue("mode") === "competitive" ? "modeCompetitiveHint" : "modePersonalHint");
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
  $("heading").textContent = t(lang, first ? "welcome" : "settingsTitle");
  $("intro").hidden = !first;
  $("save").textContent = t(lang, first ? "getStarted" : "save");
  renderAccount();
}

function avatarKey(key) {
  return Object.hasOwn(Avatar.CHARACTERS, key) ? key : "bunny";
}

function renderAvatars(current) {
  $("avatars").replaceChildren(
    ...Object.entries(Avatar.CHARACTERS).map(([key, ch]) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "avatar-opt";
      opt.setAttribute("role", "radio");
      opt.setAttribute("aria-checked", String(key === current));
      const thumb = document.createElement("canvas");
      thumb.width = 112;
      thumb.height = 140;
      thumb.setAttribute("aria-hidden", "true");
      Avatar.drawThumb(thumb, key);
      opt.append(thumb, nameText(lang, `avatar.${key}`, ch.label));
      opt.addEventListener("click", async () => {
        renderAvatars(key);
        await saveSettings({ avatar: key });
      });
      return opt;
    }),
  );
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
      card.append(dots, nameText(lang, `theme.${t.id}`, t.name));
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
  lang = await initLang(relabel);
  initial = await getSettings();
  session = await getSession();
  renderThemes(themeId(initial.theme));
  renderAvatars(avatarKey(initial.avatar));
  await getProfile();
  const preset = PRESETS.includes(String(initial.intervalMin)) ? String(initial.intervalMin) : "custom";
  radios("interval").forEach((r) => (r.checked = r.value === preset));
  $("customMin").value = initial.intervalMin;
  $("weekStart").value = String(initial.weekStart);
  renderChips(initial.areas, initial.workdays, initial.weekStart);
  $("weekStart").addEventListener("change", () => {
    const form = read();
    renderChips(form.areas, form.workdays, form.weekStart);
  });
  $("activeStart").value = initial.activeStart;
  $("activeEnd").value = initial.activeEnd;
  $("autoPause").checked = initial.autoPause;
  $("privacy").checked = initial.privacy;
  radios("mode").forEach((r) => (r.checked = r.value === initial.mode));
  $("name").value = initial.name;
  $("serverUrl").value = initial.serverUrl;
  radios("lang").forEach((r) => (r.checked = r.value === (LANGS.includes(initial.lang) ? initial.lang : "auto")));
  $("langs").addEventListener("change", (ev) => saveSettings({ lang: ev.target.value }));
  render();
  document.querySelector("main").addEventListener("input", refresh);
  document.querySelector("main").addEventListener("change", refresh);
  $("save").addEventListener("click", save);
  refresh();
  renderCalendar();
  $("calBtn").addEventListener("click", toggleCalendar);
  $("welcomeSignIn").addEventListener("click", () => startSignIn($("signInCalendar").checked, "welcomeError"));
  $("accountSignIn").addEventListener("click", () => startSignIn(false, "accountError"));
  $("signOut").addEventListener("click", leaveAccount);
  $("skipSignIn").addEventListener("click", (ev) => {
    ev.preventDefault();
    skipped = true;
    radios("mode").forEach((r) => (r.checked = r.value === "personal"));
    renderAccount();
    refresh();
  });
}

function renderChips(areas, workdays, weekStart) {
  $("areas").replaceChildren();
  $("workdays").replaceChildren();
  AREAS.forEach((a) => chip($("areas"), a, areaName(lang, a), areas.includes(a), t(lang, `areaHint.${a}`)));
  weekOrder(weekStart).forEach((d) => chip($("workdays"), d, t(lang, `day.${d}`), workdays.includes(d)));
}

async function renderCalendar(error = false) {
  const cal = await calendarState();
  const key = cal ? "calDisconnect" : "calConnect";
  $("calLabel").dataset.i18n = key;
  $("calLabel").textContent = t(lang, key);
  $("calStatus").hidden = !cal && !error;
  $("calStatus").textContent = error ? t(lang, "calFailed") : `✓ ${t(lang, "calConnected")}`;
  $("calStatus").style.color = error ? "var(--bad)" : "";
}

async function toggleCalendar() {
  $("calBtn").disabled = true;
  let error = false;
  try {
    if (await calendarState()) await disconnectCalendar();
    else await connectCalendar();
  } catch {
    error = true;
  }
  $("calBtn").disabled = false;
  await renderCalendar(error);
}

async function relabel(setting) {
  const form = read();
  const saved = await getSettings();
  lang = resolveLang(setting, navigator.language);
  applyLang(lang);
  renderThemes(themeId(saved.theme));
  renderAvatars(avatarKey(saved.avatar));
  renderChips(form.areas, form.workdays, form.weekStart);
  render();
  refresh();
  renderCalendar();
}

function renderAccount() {
  const email = session?.user?.email;
  const company = companyFromEmail(email);
  $("welcomeCard").hidden = Boolean(session) || initial.setupDone || skipped;
  $("companyText").textContent = !session ? t(lang, "notSignedIn") : company ? t(lang, "companyFrom", { domain: company }) : t(lang, "companyPersonal");
  $("accountEmail").textContent = session ? t(lang, "signedInAs", { email }) : "";
  $("accountEmail").hidden = !session;
  $("signOut").hidden = !session;
  $("accountSignIn").hidden = Boolean(session);
}

async function startSignIn(calendar, errorId) {
  $(errorId).textContent = "";
  try {
    session = await signIn({ calendar });
  } catch {
    $(errorId).textContent = t(lang, "signInFailed");
    return;
  }
  if (!$("name").value.trim()) $("name").value = session.user.name.slice(0, 40);
  renderAccount();
  refresh();
  renderCalendar();
}

async function leaveAccount() {
  if (initial.mode === "competitive") {
    await chrome.runtime.sendMessage({ type: "left-board" }).catch(() => {});
    await saveSettings({ mode: "personal" });
    initial = { ...initial, mode: "personal" };
    radios("mode").forEach((r) => (r.checked = r.value === "personal"));
  }
  await signOut();
  session = null;
  renderAccount();
  refresh();
}

init();
