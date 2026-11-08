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

/** @param {string} id */
const $ = (id) => document.getElementById(id);
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ ($(id));
/** @param {string} id */
const button = (id) => /** @type {HTMLButtonElement} */ ($(id));
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ ($(id));
/** @param {string} name */
const radios = (name) => [.../** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(`input[name="${name}"]`))];
/** @param {string} id */
const checkedInputs = (id) => [.../** @type {NodeListOf<HTMLInputElement>} */ ($(id).querySelectorAll("input:checked"))];
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
    intervalMin: preset === "custom" ? Number(input("customMin").value) : Number(preset),
    areas: checkedInputs("areas").map((i) => i.value),
    activeStart: input("activeStart").value,
    activeEnd: input("activeEnd").value,
    workdays: checkedInputs("workdays").map((i) => Number(i.value)),
    weekStart: Number(select("weekStart").value),
    autoPause: input("autoPause").checked,
    privacy: input("privacy").checked,
    mode,
    name: input("name").value.trim(),
    serverUrl: input("serverUrl").value.trim(),
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
  button("save").disabled = Boolean(err);
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
  button("save").textContent = t(lang, first ? "getStarted" : "save");
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
  input("customMin").value = String(initial.intervalMin);
  select("weekStart").value = String(initial.weekStart);
  renderChips(initial.areas, initial.workdays, initial.weekStart);
  select("weekStart").addEventListener("change", () => {
    const form = read();
    renderChips(form.areas, form.workdays, form.weekStart);
  });
  input("activeStart").value = initial.activeStart;
  input("activeEnd").value = initial.activeEnd;
  input("autoPause").checked = initial.autoPause;
  input("privacy").checked = initial.privacy;
  radios("mode").forEach((r) => (r.checked = r.value === initial.mode));
  input("name").value = initial.name;
  input("serverUrl").value = initial.serverUrl;
  radios("lang").forEach((r) => (r.checked = r.value === (LANGS.includes(initial.lang) ? initial.lang : "auto")));
  $("langs").addEventListener("change", (ev) => saveSettings({ lang: /** @type {HTMLInputElement} */ (ev.target).value }));
  render();
  document.querySelector("main").addEventListener("input", refresh);
  document.querySelector("main").addEventListener("change", refresh);
  button("save").addEventListener("click", save);
  refresh();
  renderCalendar();
  button("calBtn").addEventListener("click", toggleCalendar);
  $("welcomeSignIn").addEventListener("click", () => startSignIn(input("signInCalendar").checked, "welcomeError"));
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
  button("calBtn").disabled = true;
  let error = false;
  try {
    if (await calendarState()) await disconnectCalendar();
    else await connectCalendar();
  } catch {
    error = true;
  }
  button("calBtn").disabled = false;
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
  chrome.runtime.sendMessage({ type: "sync" }).catch(() => {}); // first sync: uploads the local break history
  if (!input("name").value.trim()) input("name").value = session.user.name.slice(0, 40);
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
