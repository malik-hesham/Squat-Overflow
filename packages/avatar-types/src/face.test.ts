import { describe, expect, it } from 'vitest';
import { ARKIT_BLENDSHAPES } from './blendshapes.ts';
import { VISEMES, isVisemeId } from './visemes.ts';

describe('VISEMES', () => {
  it('are the 15 Oculus visemes, silence first', () => {
    expect(VISEMES).toEqual([
      'sil',
      'PP',
      'FF',
      'TH',
      'DD',
      'kk',
      'CH',
      'SS',
      'nn',
      'RR',
      'aa',
      'E',
      'I',
      'O',
      'U',
    ]);
  });

  it('recognises only those ids, case included', () => {
    expect(VISEMES.every(isVisemeId)).toBe(true);
    for (const other of ['viseme_aa', 'AA', 'pp', '', 'toString', 0, null, undefined]) {
      expect(isVisemeId(other)).toBe(false);
    }
  });
});

describe('ARKIT_BLENDSHAPES', () => {
  it('lists the 52 ARKit face shapes once each', () => {
    expect(ARKIT_BLENDSHAPES).toHaveLength(52);
    expect(new Set(ARKIT_BLENDSHAPES).size).toBe(52);
    expect(ARKIT_BLENDSHAPES).toEqual(
      expect.arrayContaining(['eyeBlinkLeft', 'jawOpen', 'mouthFunnel', 'browInnerUp', 'tongueOut'])
    );
  });

  it('has a Right shape for every Left shape', () => {
    const names: readonly string[] = ARKIT_BLENDSHAPES;
    const lefts = names.filter((name) => name.endsWith('Left'));

    // 52 = 12 unpaired shapes (jawOpen, mouthFunnel, cheekPuff, tongueOut, …) + 20 Left/Right pairs.
    expect(lefts).toHaveLength(20);
    for (const left of lefts) expect(names).toContain(left.replace(/Left$/, 'Right'));
  });
});
