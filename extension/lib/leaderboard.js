import { API_URL } from "../config.js";
import { levelFor, isoWeek } from "./xp.js";
import { getSession } from "./session.js";

/**
 * Where the board lives and how to get a signed-in session; tests pass their own.
 * @typedef {{ url: string, session: () => Promise<{ accessToken: string } | null> }} BoardConfig
 */
/** @type {BoardConfig} */
const DEFAULT_CFG = { url: API_URL, session: getSession };
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

/** Puts my score on my company's board, or with `remove` takes it off. Resolves false on any failure. */
export async function submitScore(profile, settings, { remove = false } = {}, cfg = DEFAULT_CFG) {
  if (!cfg.url) return false;
  if (!remove && settings.mode !== "competitive") return false;
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
