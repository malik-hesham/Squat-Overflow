import { isoWeekNumber } from "./xp.js";

// Pain areas, matching the pose catalog's categories (five or six exercises each).
export const AREAS = [
  "Neck tension",
  "Rounded shoulders",
  "Upper back",
  "Shoulder & rotator cuff",
  "Lower back",
  "Wrist & hand",
  "Knees",
  "Eyes",
];

export const BREAK_REPS = 6;

// Eyes is opt-in: it never becomes the weekly featured area, so a break only
// has eye exercises for people who picked Eyes.
const FEATURED_AREAS = AREAS.filter((a) => a !== "Eyes");

// Area names from before the pain areas, so saved settings and this week's
// challenge keep working after the update.
const LEGACY_AREAS = {
  Neck: ["Neck tension"],
  Shoulders: ["Shoulder & rotator cuff"],
  "Upper back & posture": ["Upper back", "Rounded shoulders"],
  "Arms & wrists": ["Wrist & hand"],
  "Lower back & core": ["Lower back"],
  "Hips & glutes": ["Lower back", "Knees"],
  "Legs & circulation": ["Knees"],
};

// Saved areas -> current area names, in AREAS order. Old names map to their
// closest new areas, and unknown names are dropped.
export function currentAreas(areas) {
  const named = new Set((areas ?? []).flatMap((a) => LEGACY_AREAS[a] ?? [a]));
  return AREAS.filter((a) => named.has(a));
}

export function featuredArea(now) {
  return FEATURED_AREAS[isoWeekNumber(now) % FEATURED_AREAS.length];
}

const toMove = (e) => ({
  key: e.key,
  label: e.label,
  area: e.category,
  camera: e.camera,
  stance: e.stance ?? "seated",
  how_to: e.how_to,
  target: BREAK_REPS,
});

export function buildRoutine(catalog, { areas, lastKey, n }) {
  const slots = [];
  for (let i = 0; slots.length < 3 && areas.length && i < 3; i++) {
    slots.push(areas[(n + i) % areas.length]);
  }
  const moves = [];
  for (const area of slots) {
    const list = catalog.filter((e) => e.category === area);
    for (let k = 0; k < list.length; k++) {
      const e = list[(n + k) % list.length];
      if (moves.some((m) => m.key === e.key)) continue;
      if (!moves.length && e.key === lastKey) continue;
      moves.push(toMove(e));
      break;
    }
  }
  return moves;
}

export function swapMove(catalog, moves, i) {
  const list = catalog.filter((x) => x.category === moves[i].area);
  const start = list.findIndex((x) => x.key === moves[i].key);
  for (let step = 1; step < list.length; step++) {
    const e = list[(start + step + list.length) % list.length];
    if (!moves.some((m, k) => k !== i && m.key === e.key)) return toMove(e);
  }
  return null;
}

// Side-on and standing moves need the user to step back into frame first.
export function needsPositioning(move) {
  return move.camera === "side" || move.stance === "standing";
}

export function nextOpenMove(moves, progress, from) {
  for (let step = 1; step <= moves.length; step++) {
    const k = (from + step) % moves.length;
    if (progress[k].reps < moves[k].target) return k;
  }
  return -1;
}
