import { GOOGLE_CLIENT_ID } from "../config.js";
import { buildAuthUrl, parseAuthResponse, parseBusy } from "./calendar.js";

const KEY = "calendar";
const BUSY_KEY = "calendarBusy";
const CACHE_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;

async function authorize(interactive) {
  const redirectUri = chrome.identity.getRedirectURL();
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: buildAuthUrl(GOOGLE_CLIENT_ID, redirectUri, interactive),
    interactive,
  });
  const auth = redirect ? parseAuthResponse(redirect, Date.now()) : null;
  if (!auth) throw new Error("Google sign-in was cancelled");
  await chrome.storage.local.set({ [KEY]: { connected: true, ...auth } });
  return auth.token;
}

export async function calendarState() {
  const { [KEY]: cal } = await chrome.storage.local.get(KEY);
  return cal?.connected ? cal : null;
}

export function connectCalendar() {
  return authorize(true);
}

export async function disconnectCalendar() {
  const cal = await calendarState();
  await chrome.storage.local.remove([KEY, BUSY_KEY]);
  if (cal?.token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cal.token)}`, { method: "POST" }).catch(() => {});
  }
}

async function validToken(cal) {
  if (cal.expiresAt - Date.now() > 60_000) return cal.token;
  try {
    return await authorize(false);
  } catch {
    return null;
  }
}

async function queryBusy(token, now) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: new Date(now - HOUR_MS).toISOString(),
      timeMax: new Date(now + 24 * HOUR_MS).toISOString(),
      items: [{ id: "primary" }],
    }),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`freeBusy ${res.status}`);
  return parseBusy(await res.json());
}

export async function getBusy(now = Date.now()) {
  const cal = await calendarState();
  if (!cal) return [];
  const { [BUSY_KEY]: cached } = await chrome.storage.local.get(BUSY_KEY);
  if (cached && now - cached.fetchedAt < CACHE_MS) return cached.busy;
  try {
    let token = await validToken(cal);
    let busy = token ? await queryBusy(token, now) : null;
    if (busy === null) {
      token = await authorize(false).catch(() => null);
      busy = token ? await queryBusy(token, now) : null;
    }
    if (busy === null) return cached?.busy ?? [];
    await chrome.storage.local.set({ [BUSY_KEY]: { fetchedAt: now, busy } });
    return busy;
  } catch {
    return cached?.busy ?? [];
  }
}
