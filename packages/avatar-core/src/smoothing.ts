// Small maths shared by the face, eye and procedural layers.

/** A value this close to its goal has arrived (and is set to the goal exactly). */
export const SETTLED = 1e-4;

/**
 * Moves `current` towards `goal` with the time constant `tauMs` (63% of the way after tauMs). The
 * result depends only on the time that passed, not on how it was split into frames.
 */
export function approach(current: number, goal: number, dtMs: number, tauMs: number): number {
  const next = goal + (current - goal) * Math.exp(-dtMs / tauMs);
  return Math.abs(next - goal) < SETTLED ? goal : next;
}

/** Degrees to radians. */
export function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0 at 0, 1 at 1, flat at both ends. */
export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** A uniform number in [min, max). */
export function between(random: { next(): number }, min: number, max: number): number {
  return min + (max - min) * random.next();
}
