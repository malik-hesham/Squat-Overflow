export const THEMES = [
  { id: "auto", name: "Auto", swatch: ["#3ddc97", "#0f1214", "#f4f6f7"] },
  { id: "midnight", name: "Midnight Gym", swatch: ["#3ddc97", "#0f1214", "#ffd166"] },
  { id: "daylight", name: "Daylight", swatch: ["#12a66a", "#f4f6f7", "#b98900"] },
  { id: "sunrise", name: "Sunrise Stretch", swatch: ["#ff7a59", "#fff7ef", "#e89a00"] },
  { id: "ocean", name: "Ocean Flow", swatch: ["#2ec4e6", "#0b1724", "#ffd166"] },
  { id: "forest", name: "Forest Zen", swatch: ["#8fd694", "#0f1a14", "#e9c46a"] },
  { id: "neon", name: "Neon Arcade", swatch: ["#ff3ea5", "#0d0a14", "#ffe600"] },
];

export function themeId(id) {
  return THEMES.some((t) => t.id === id) ? id : "auto";
}

export function applyTheme(id) {
  document.documentElement.dataset.theme = themeId(id);
}

export async function initTheme() {
  const { theme } = await chrome.storage.local.get("theme");
  applyTheme(theme);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "theme" in changes) applyTheme(changes.theme.newValue);
  });
}
