import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
import { levelFor, isoWeek } from "./xp.js";

const DEFAULT_CFG = { url: SUPABASE_URL, key: SUPABASE_KEY };

async function rpc(fn, body, cfg) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
}

export function toPayload(profile, settings, remove, now = Date.now()) {
  const week = isoWeek(now);
  const current = profile.week === week;
  return {
    p_id: profile.playerId,
    p_secret: profile.secret,
    p_name: settings.name,
    p_company: settings.company.toLowerCase(),
    p_xp: profile.xp,
    p_level: levelFor(profile.xp).level,
    p_streak: profile.streak,
    p_week_xp: current ? profile.weekXp : 0,
    p_week: week,
    p_delete: remove,
  };
}

export async function submitScore(profile, settings, { remove = false } = {}, cfg = DEFAULT_CFG) {
  if (!cfg.url || !cfg.key) return false;
  if (!remove && settings.mode !== "competitive") return false;
  try {
    return (await rpc("submit_score", toPayload(profile, settings, remove), cfg)) === true;
  } catch {
    return false;
  }
}

export async function fetchBoard(company, period, playerId, cfg = DEFAULT_CFG) {
  if (!cfg.url || !cfg.key) return null;
  try {
    const rows = await rpc("leaderboard", { p_company: company.toLowerCase(), p_period: period, p_player: playerId }, cfg);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}
