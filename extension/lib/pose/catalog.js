/** The exercise list the clients show (port of `exercise_catalog()` in server/app.py). */
import { DEMOS, demoToJson } from "./demos.js";
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
 * @property {import("./demos.js").DemoVideoJson | null} demo
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
    demo: Object.prototype.hasOwnProperty.call(DEMOS, e.key) ? demoToJson(DEMOS[e.key]) : null,
  }));
}
