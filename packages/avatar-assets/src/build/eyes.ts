// Where a model's eyes are, measured from its eye mesh the way the renderer draws it: each vertex
// through its joints (joint world × inverse bind, weighted), which also undoes the quantization the
// shipped files use. The build writes the result into the manifest; the tests measure the shipped
// files again and compare.
import type { EyeCentres, Vec3 } from '@squat-overflow/avatar-types';

/** A skinned mesh's raw data, read from a glTF (scripts/skinned-mesh.mts reads it). */
export interface SkinnedMesh {
  /** x, y, z per vertex, as stored (denormalised). */
  readonly positions: ArrayLike<number>;
  /** Four joint indices and four weights per vertex. */
  readonly joints: ArrayLike<number>;
  readonly weights: ArrayLike<number>;
  /** Per joint of the skin, column-major 4×4: its world matrix and its inverse bind matrix. */
  readonly jointWorlds: readonly ArrayLike<number>[];
  readonly inverseBinds: readonly ArrayLike<number>[];
}

/** The centre of each eyeball: the middle of the vertices on its side (+X is the avatar's left). */
export function eyeCentres(mesh: SkinnedMesh): EyeCentres {
  const skins = mesh.jointWorlds.map((world, j) => multiply(world, mesh.inverseBinds[j] ?? []));
  const left = new Bounds();
  const right = new Bounds();
  const count = mesh.positions.length / 3;
  for (let v = 0; v < count; v++) {
    const p = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const weight = mesh.weights[v * 4 + k] ?? 0;
      if (weight === 0) continue;
      const m = skins[mesh.joints[v * 4 + k] ?? 0] ?? [];
      const [x, y, z] = [0, 1, 2].map((i) => mesh.positions[v * 3 + i] ?? 0) as [
        number,
        number,
        number,
      ];
      for (let i = 0; i < 3; i++) {
        p[i] =
          (p[i] ?? 0) +
          weight * ((m[i] ?? 0) * x + (m[4 + i] ?? 0) * y + (m[8 + i] ?? 0) * z + (m[12 + i] ?? 0));
      }
    }
    ((p[0] ?? 0) > 0 ? left : right).add(p);
  }
  if (left.empty || right.empty) throw new Error('eyeCentres: the eye mesh must have both eyes');
  return { left: left.centre(), right: right.centre() };
}

class Bounds {
  readonly #min = [Infinity, Infinity, Infinity];
  readonly #max = [-Infinity, -Infinity, -Infinity];
  empty = true;

  add(p: readonly number[]): void {
    this.empty = false;
    for (let i = 0; i < 3; i++) {
      this.#min[i] = Math.min(this.#min[i] ?? Infinity, p[i] ?? 0);
      this.#max[i] = Math.max(this.#max[i] ?? -Infinity, p[i] ?? 0);
    }
  }

  centre(): Vec3 {
    const mid = (i: number) => ((this.#min[i] ?? 0) + (this.#max[i] ?? 0)) / 2;
    return [mid(0), mid(1), mid(2)];
  }
}

/** a × b, both column-major 4×4. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
