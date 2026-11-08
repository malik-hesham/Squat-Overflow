import { DEMOS } from './analysis/demos';
import { CATALOG } from './analysis/exercises';

/** One exercise as the clients see it (/health and the WebSocket "ready" message). */
export interface CatalogEntry {
  key: string;
  label: string;
  metric: string;
  camera: string;
  category: string;
  how_to: string;
  stance: string;
  demo: ReturnType<NonNullable<ReturnType<typeof DEMOS.get>>['toJson']> | null;
}

export function exerciseCatalog(): CatalogEntry[] {
  return [...CATALOG.values()].map((e) => ({
    key: e.key,
    label: e.label,
    metric: e.metric,
    camera: e.camera,
    category: e.category,
    how_to: e.howTo,
    stance: e.stance,
    demo: DEMOS.get(e.key)?.toJson() ?? null,
  }));
}
