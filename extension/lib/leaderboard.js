import { API_URL, SYNC_ENABLED } from "../config.js";
import { levelFor, isoWeek } from "./xp.js";
import { getSession } from "./session.js";

/**
 * Where the board lives, how to get a signed-in session, and whether sync is on (then the server
 * writes my row from synced breaks and settings); tests pass their own.
 * @typedef {{ url: string, session: () => Promise<{ accessToken: string } | null>, sync?: boolean }} BoardConfig
 */
/** @type {BoardConfig} */
const DEFAULT_CFG = { url: API_URL, session: getSession, sync: SYNC_ENABLED };
const AVATAR_RE = /^[a-z]{2,20}$/;

function call(method, path, cfg, session, body) {
  return fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function toPayload(profile, settings, now = Date.now()) {
  const week = isoWeek(now);
  const current = profile.week === week;
  return {
    name: settings.name,
    xp: profile.xp,
    level: levelFor(profile.xp).level,
    streak: profile.streak,
    weekXp: current ? profile.weekXp : 0,
    week,
    avatar: AVATAR_RE.test(settings.avatar ?? "") ? settings.avatar : "bunny",
  };
}

/**
 * Puts my score on my company's board, or with `remove` takes it off. Resolves false on any
 * failure. With sync on there is nothing to put: the server keeps the row up to date itself.
 */
export async function submitScore(profile, settings, { remove = false } = {}, cfg = DEFAULT_CFG) {
  if (!cfg.url) return false;
  if (!remove && settings.mode !== "competitive") return false;
  if (!remove && cfg.sync) return true;
  try {
    const session = await cfg.session();
    if (!session) return false;
    const res = remove
      ? await call("DELETE", "/leaderboard/me", cfg, session)
      : await call("PUT", "/leaderboard/me", cfg, session, toPayload(profile, settings));
    return res.ok;
  } catch {
    return false;
  }
}

/** My company's board for "week" or "all", or null when it can't be loaded. */
export async function fetchBoard(period, cfg = DEFAULT_CFG) {
  if (!cfg.url) return null;
  try {
    const session = await cfg.session();
    if (!session) return null;
    const res = await call("GET", `/leaderboard?period=${encodeURIComponent(period)}`, cfg, session);
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}
