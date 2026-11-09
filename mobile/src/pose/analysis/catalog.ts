/** The exercise list the server sent to clients (port of `exercise_catalog()` in server/app.py). */

import { DEMOS, type DemoVideoJson, demoToJson } from './demos';
import { CATALOG, type Camera, type Stance } from './exercises';

export interface CatalogEntry {
  key: string;
  label: string;
  metric: string;
  camera: Camera;
  category: string;
  how_to: string;
  stance: Stance;
  demo: DemoVideoJson | null;
}

export function exerciseCatalog(): CatalogEntry[] {
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
