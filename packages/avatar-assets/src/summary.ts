// What the asset checks need to know about a model, read from its glTF JSON.

export interface ModelSummary {
  /** Joint names of every skin, first appearance order, no repeats. */
  readonly bones: readonly string[];
  /** Mesh name → its morph target names (glTF `mesh.extras.targetNames`, which three.js reads). */
  readonly morphTargets: Readonly<Record<string, readonly string[]>>;
  /** Triangles across all triangle-list primitives. */
  readonly triangles: number;
  readonly animations: readonly string[];
}

const TRIANGLES = 4; // glTF primitive mode; the default when `mode` is left out

type Json = Readonly<Record<string, unknown>>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function nameOf(value: unknown, fallback: string): string {
  const name = isJson(value) ? value['name'] : undefined;
  return typeof name === 'string' ? name : fallback;
}

export function summarizeGltf(json: unknown): ModelSummary {
  if (!isJson(json)) throw new Error('glTF JSON must be an object');
  const nodes = list(json['nodes']);
  const accessors = list(json['accessors']);
  const count = (index: unknown): number => {
    const accessor = typeof index === 'number' ? accessors[index] : undefined;
    const n = isJson(accessor) ? accessor['count'] : undefined;
    return typeof n === 'number' ? n : 0;
  };

  const bones = new Set<string>();
  for (const skin of list(json['skins'])) {
    for (const joint of list(isJson(skin) ? skin['joints'] : undefined)) {
      if (typeof joint === 'number') bones.add(nameOf(nodes[joint], `node${joint}`));
    }
  }

  const morphTargets: Record<string, readonly string[]> = {};
  let triangles = 0;
  list(json['meshes']).forEach((mesh, i) => {
    const extras = isJson(mesh) ? mesh['extras'] : undefined;
    const names = list(isJson(extras) ? extras['targetNames'] : undefined);
    morphTargets[nameOf(mesh, `mesh${i}`)] = names.filter(
      (n): n is string => typeof n === 'string'
    );
    for (const primitive of list(isJson(mesh) ? mesh['primitives'] : undefined)) {
      if (!isJson(primitive) || (primitive['mode'] ?? TRIANGLES) !== TRIANGLES) continue;
      const attributes = primitive['attributes'];
      const corners =
        primitive['indices'] !== undefined
          ? count(primitive['indices'])
          : count(isJson(attributes) ? attributes['POSITION'] : undefined);
      triangles += corners / 3;
    }
  });

  const animations = list(json['animations']).map((a, i) => nameOf(a, `animation${i}`));
  return { bones: [...bones], morphTargets, triangles, animations };
}
