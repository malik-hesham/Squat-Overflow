import { describe, expect, it } from 'vitest';
import { parseSpeechResponse } from './speech.ts';

/** "Hi": 420 ms of audio. Times are in milliseconds from the start of the audio. */
function hello() {
  return {
    audioUrl: 'https://speech.example.test/a/hello.mp3',
    duration: 420,
    visemes: [
      { timestamp: 0, duration: 60, viseme: 'sil', weight: 1 },
      { timestamp: 60, duration: 140, viseme: 'aa', weight: 0.8 },
      { timestamp: 200, duration: 150, viseme: 'I', weight: 0.7 },
      { timestamp: 350, duration: 70, viseme: 'sil', weight: 1 },
    ],
  };
}

describe('parseSpeechResponse', () => {
  it('accepts a valid response and returns a copy with only the known fields', () => {
    const input = {
      ...hello(),
      provider: 'mock',
      visemes: hello().visemes.map((v) => ({ ...v, extra: true })),
    };

    const result = parseSpeechResponse(input);

    expect(result).toEqual({ ok: true, value: hello() });
    expect(result.ok && result.value.visemes[0]).not.toBe(input.visemes[0]);
  });

  it.each([
    ['null', null, 'response: must be an object'],
    ['a string', 'hello.mp3', 'response: must be an object'],
    ['an array', [], 'response: must be an object'],
    ['no audioUrl', { ...hello(), audioUrl: undefined }, 'audioUrl: must be a non-empty string'],
    ['an empty audioUrl', { ...hello(), audioUrl: '' }, 'audioUrl: must be a non-empty string'],
    ['a zero duration', { ...hello(), duration: 0 }, 'duration: must be a finite number above 0'],
    ['a NaN duration', { ...hello(), duration: NaN }, 'duration: must be a finite number above 0'],
    [
      'an infinite duration',
      { ...hello(), duration: Infinity },
      'duration: must be a finite number above 0',
    ],
    [
      'a duration as text',
      { ...hello(), duration: '420' },
      'duration: must be a finite number above 0',
    ],
    ['no visemes', { ...hello(), visemes: undefined }, 'visemes: must be an array'],
  ])('rejects %s', (_name, input, error) => {
    expect(parseSpeechResponse(input)).toEqual({ ok: false, errors: [error] });
  });

  const VISEME_LIST = 'sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U';
  it.each([
    ['an event that is not an object', 'aa', 'visemes[1]: must be an object'],
    [
      'an unknown viseme',
      { viseme: 'viseme_aa' },
      `visemes[1].viseme: must be one of ${VISEME_LIST}`,
    ],
    ['a lower-case viseme', { viseme: 'pp' }, `visemes[1].viseme: must be one of ${VISEME_LIST}`],
    ['a weight above 1', { weight: 1.2 }, 'visemes[1].weight: must be a number from 0 to 1'],
    ['a negative weight', { weight: -0.1 }, 'visemes[1].weight: must be a number from 0 to 1'],
    ['a NaN weight', { weight: NaN }, 'visemes[1].weight: must be a number from 0 to 1'],
    [
      'a negative timestamp',
      { timestamp: -1 },
      'visemes[1].timestamp: must be a finite number of 0 or more',
    ],
    [
      'a NaN timestamp',
      { timestamp: NaN },
      'visemes[1].timestamp: must be a finite number of 0 or more',
    ],
    ['a zero duration', { duration: 0 }, 'visemes[1].duration: must be a finite number above 0'],
    [
      'an infinite duration',
      { duration: Infinity },
      'visemes[1].duration: must be a finite number above 0',
    ],
  ])('rejects %s', (_name, patch, error) => {
    const input = hello();
    const event = typeof patch === 'string' ? patch : { ...input.visemes[1], ...patch };

    const visemes = input.visemes.map((v, i) => (i === 1 ? event : v));

    expect(parseSpeechResponse({ ...input, visemes })).toEqual({ ok: false, errors: [error] });
  });

  it('rejects an event that ends after the audio', () => {
    const input = hello();
    const visemes = input.visemes.map((v, i) => (i === 3 ? { ...v, duration: 80 } : v));

    expect(parseSpeechResponse({ ...input, visemes })).toEqual({
      ok: false,
      errors: ['visemes[3]: ends at 430 ms, after the audio ends (420 ms)'],
    });
  });

  it('accepts an event that ends exactly with the audio, despite float rounding', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    const input = {
      audioUrl: 'blob:x',
      duration: 0.3,
      visemes: [{ timestamp: 0.1, duration: 0.2, viseme: 'aa', weight: 1 }],
    };

    expect(parseSpeechResponse(input).ok).toBe(true);
  });

  it('rejects events that are not in time order; overlapping events are fine', () => {
    const input = hello();
    const visemes = input.visemes.map((v, i) => (i === 2 ? { ...v, timestamp: 50 } : v));

    expect(parseSpeechResponse({ ...input, visemes })).toEqual({
      ok: false,
      errors: [
        'visemes[2]: starts at 50 ms, before the event above it (60 ms); events must be in time order',
      ],
    });
  });

  it('reports every problem, each with its path', () => {
    const input = hello();
    const visemes = input.visemes.map((v, i) =>
      i === 0 ? { ...v, weight: 2 } : i === 2 ? { ...v, viseme: 'X', duration: -1 } : v
    );

    expect(parseSpeechResponse({ ...input, audioUrl: '', visemes })).toEqual({
      ok: false,
      errors: [
        'audioUrl: must be a non-empty string',
        'visemes[0].weight: must be a number from 0 to 1',
        'visemes[2].duration: must be a finite number above 0',
        `visemes[2].viseme: must be one of ${VISEME_LIST}`,
      ],
    });
  });
});
