// How each part of the model is drawn. MPFB's materials export as transparent (alpha BLEND) and
// double-sided, which shows the teeth through the skin and breaks draw order; this sets them right.

export interface MaterialSettings {
  readonly alphaMode: 'OPAQUE' | 'MASK';
  readonly alphaCutoff: number | null;
  readonly doubleSided: boolean;
}

const OPAQUE: MaterialSettings = { alphaMode: 'OPAQUE', alphaCutoff: null, doubleSided: false };

/** Parts with see-through texels; every other part is opaque and one-sided. */
const CUTOUTS: Readonly<Record<string, MaterialSettings>> = {
  // An eyeball inside a clear cornea shell: cutting the shell out lets the iris show.
  Eyes: { alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: false },
  // Thin textured cards, seen from both sides.
  Hair: { alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true },
  // Strands only a few texels wide: a lower cutoff keeps them from breaking up into dots.
  Eyebrows: { alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true },
  Eyelashes: { alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true },
};

/** `part` is the mesh's name in the model (build_human.py names them: Body, Eyes, Hair, ...). */
export function materialSettings(part: string): MaterialSettings {
  return CUTOUTS[part] ?? OPAQUE;
}
