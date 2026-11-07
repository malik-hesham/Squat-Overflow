import { isoWeekNumber } from "./xp.js";

export const AREAS = [
  "Neck",
  "Shoulders",
  "Upper back & posture",
  "Arms & wrists",
  "Lower back & core",
  "Hips & glutes",
  "Legs & circulation",
];

export const BREAK_REPS = 6;

const FULL_BODY_AREAS = ["Hips & glutes", "Legs & circulation"];

export function featuredArea(now) {
  return AREAS[isoWeekNumber(now) % AREAS.length];
}

const toMove = (e) => ({
  key: e.key,
  label: e.label,
  area: e.category,
  camera: e.camera,
  how_to: e.how_to,
  demo: e.demo ?? null,
  target: BREAK_REPS,
});

export function buildRoutine(catalog, { areas, featured, lastKey, n }) {
  const slots = areas.includes(featured) ? [] : [featured];
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
  const area = moves[i].area;
  const e = catalog.find((x) => x.category === area && !moves.some((m) => m.key === x.key));
  return e ? toMove(e) : null;
}

export function needsPositioning(move) {
  return move.camera === "side" || FULL_BODY_AREAS.includes(move.area);
}

export function nextOpenMove(moves, progress, from) {
  for (let step = 1; step <= moves.length; step++) {
    const k = (from + step) % moves.length;
    if (progress[k].reps < moves[k].target) return k;
  }
  return -1;
}
