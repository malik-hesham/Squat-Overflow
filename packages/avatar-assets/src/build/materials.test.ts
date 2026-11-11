import { describe, expect, it } from 'vitest';
import { materialSettings } from './materials.ts';

describe('materialSettings', () => {
  it.each(['Body', 'Teeth', 'Tongue', 'male_casualsuit06', 'shoes01'])(
    '%s is opaque and one-sided (no see-through skin, no sorting problems)',
    (part) => {
      expect(materialSettings(part)).toEqual({
        alphaMode: 'OPAQUE',
        alphaCutoff: null,
        doubleSided: false,
      });
    }
  );

  it('cuts out the clear cornea around the eyeball, so the iris shows through it', () => {
    expect(materialSettings('Eyes')).toEqual({
      alphaMode: 'MASK',
      alphaCutoff: 0.5,
      doubleSided: false,
    });
  });

  it('draws hair as alpha-tested cards, seen from both sides', () => {
    expect(materialSettings('Hair')).toEqual({
      alphaMode: 'MASK',
      alphaCutoff: 0.5,
      doubleSided: true,
    });
  });

  it.each(['Eyebrows', 'Eyelashes'])(
    'keeps more of the thin strands of %s (lower cutoff)',
    (part) => {
      expect(materialSettings(part)).toEqual({
        alphaMode: 'MASK',
        alphaCutoff: 0.3,
        doubleSided: true,
      });
    }
  );
});
