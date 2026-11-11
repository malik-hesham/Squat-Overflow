/** The exercise list the clients show (port of `exercise_catalog()` in server/app.py). */
import { CATALOG } from "./exercises.js";

/**
 * @typedef {object} CatalogEntry
 * @property {string} key
 * @property {string} label
 * @property {string} metric
 * @property {import("./exercises.js").Camera} camera
 * @property {string} category
 * @property {string} how_to
 * @property {import("./exercises.js").Stance} stance
 * @property {number | null} reps reps in a break; null = the break's default
 * @property {number} hold seconds each rep holds its target (0 = no hold)
 */

/** @returns {CatalogEntry[]} */
export function exerciseCatalog() {
  return Object.values(CATALOG).map((e) => ({
    key: e.key,
    label: e.label,
    metric: e.metric,
    camera: e.camera,
    category: e.category,
    how_to: e.howTo,
    stance: e.stance,
    reps: e.reps,
    hold: e.hold,
  }));
}
