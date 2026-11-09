import { PNG } from 'pngjs';

import { encodeMask } from '../../src/pose/mask';
import type { Mask } from '../../src/pose/pose-engine';

function decode(dataUrl: string): PNG {
  const prefix = 'data:image/png;base64,';
  expect(dataUrl.startsWith(prefix)).toBe(true);
  return PNG.sync.read(Buffer.from(dataUrl.slice(prefix.length), 'base64'));
}

const alphaAt = (png: PNG, x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];

function mask(h: number, w: number, fill?: (x: number, y: number) => boolean): Mask {
  const data = new Float32Array(w * h);
  if (fill) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y) ? 1 : 0;
  return { data, width: w, height: h };
}

/** A standing "person": rows 60..299, columns 200..279 of a 360x480 frame. */
const person = () => mask(360, 480, (x, y) => y >= 60 && y < 300 && x >= 200 && x < 280);

test('mask is small RGBA with person in alpha', () => {
  const png = decode(encodeMask(person()));
  expect(Math.max(png.width, png.height)).toBe(160);
  expect(png.height / png.width).toBe(0.75);
  expect(alphaAt(png, 80, 80)).toBe(255); // centre of the person (scaled 1/3)
  expect(alphaAt(png, 5, 5)).toBe(0); // far background
  expect(png.data[0]).toBe(255); // colour is white; only alpha carries the mask
});

test('mask is grown beyond the person', () => {
  const png = decode(encodeMask(person()));
  let original = 0;
  let grown = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const inPerson = y * 3 >= 60 && y * 3 < 300 && x * 3 >= 200 && x * 3 < 280;
      const covered = alphaAt(png, x, y) > 127;
      if (inPerson) {
        original++;
        expect(covered).toBe(true); // never shrinks: every person pixel stays covered
      }
      if (covered) grown++;
    }
  }
  expect(grown).toBeGreaterThan(original * 1.2);
});

test('landmarks cover limbs and head the mask missed', () => {
  const lms: number[][] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.0]); // unseen by default
  lms[0] = [0.5, 0.15, 0.99]; // nose
  lms[11] = [0.6, 0.3, 0.99]; // shoulders
  lms[12] = [0.4, 0.3, 0.99];
  lms[13] = [0.75, 0.3, 0.99]; // left arm out sideways
  lms[15] = [0.9, 0.3, 0.99];
  const png = decode(encodeMask(mask(360, 480), lms));
  const { width: w, height: h } = png;
  expect(alphaAt(png, Math.round(0.82 * w), Math.round(0.3 * h))).toBe(255); // forearm, missed by the empty mask
  expect(alphaAt(png, Math.round(0.5 * w), Math.round(0.15 * h))).toBe(255); // face
  expect(alphaAt(png, Math.round(0.1 * w), Math.round(0.9 * h))).toBe(0); // unrelated background
  // A connection to an unseen landmark is not drawn.
  expect(alphaAt(png, Math.round(0.6 * w), Math.round(0.7 * h))).toBe(0);
});

test('empty mask stays empty', () => {
  const png = decode(encodeMask(mask(90, 120)));
  expect(Math.max(...Array.from({ length: png.width * png.height }, (_, i) => png.data[i * 4 + 3]))).toBe(0);
});
