import { DAILY_POOL } from "./challenges.js";
import { t, areaName, nameText } from "./i18n.js";

const DAILY_ICONS = { variety: "🌈", high_five: "✋", clean_form: "💎", early_mover: "🌅", no_excuses: "🔥" };

export function badgeLabel(id, lang = "en") {
  const [kind, rest] = id.split(":");
  if (kind === "weekly") return `🏅 ${t(lang, "areaWeek", { area: areaName(lang, rest) })}`;
  const c = DAILY_POOL.find((x) => x.id === rest);
  return `${DAILY_ICONS[rest] ?? "⭐"} ${nameText(lang, `challenge.${rest}`, c?.name ?? rest)}`;
}

export function challengeIcon(id) {
  return id === "weekly" ? "🏅" : DAILY_ICONS[id] ?? "⭐";
}
