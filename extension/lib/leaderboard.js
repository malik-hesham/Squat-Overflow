import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
import { levelFor, isoWeek } from "./xp.js";
import { getSession } from "./session.js";

const DEFAULT_CFG = { url: SUPABASE_URL, key: SUPABASE_KEY, session: getSession };
const AVATAR_RE = /^[a-z]{2,20}$/;

async function rpc(fn, body, cfg, session) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
}

export function toPayload(profile, settings, remove, now = Date.now()) {
  const week = isoWeek(now);
  const current = profile.week === week;
  return {
    p_name: settings.name,
    p_xp: profile.xp,
    p_level: levelFor(profile.xp).level,
    p_streak: profile.streak,
    p_week_xp: current ? profile.weekXp : 0,
    p_week: week,
    p_delete: remove,
    p_avatar: AVATAR_RE.test(settings.avatar ?? "") ? settings.avatar : "bunny",
  };
}

export async function submitScore(profile, settings, { remove = false } = {}, cfg = DEFAULT_CFG) {
  if (!cfg.url || !cfg.key) return false;
  if (!remove && settings.mode !== "competitive") return false;
  try {
    const session = await cfg.session();
    if (!session) return false;
    return (await rpc("submit_score", toPayload(profile, settings, remove), cfg, session)) === true;
  } catch {
    return false;
  }
}

export async function fetchBoard(period, cfg = DEFAULT_CFG) {
  if (!cfg.url || !cfg.key) return null;
  try {
    const session = await cfg.session();
    if (!session) return null;
    const rows = await rpc("leaderboard", { p_period: period }, cfg, session);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}
