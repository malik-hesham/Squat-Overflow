import { DAILY_POOL } from "./challenges.js";

const DAILY_ICONS = { variety: "🌈", high_five: "✋", clean_form: "💎", early_mover: "🌅", no_excuses: "🔥" };

export function badgeLabel(id) {
  const [kind, rest] = id.split(":");
  if (kind === "weekly") return `🏅 ${rest} week`;
  const c = DAILY_POOL.find((x) => x.id === rest);
  return `${DAILY_ICONS[rest] ?? "⭐"} ${c?.name ?? rest}`;
}
