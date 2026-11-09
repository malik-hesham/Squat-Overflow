/**
 * Person mask -> small RGBA PNG data URL whose alpha is the mask (the client's privacy blur).
 *
 * Pure-TS replacement for the OpenCV pipeline in the Python server: area resize,
 * skeleton cover, elliptical dilation, Gaussian feather, PNG encode. The images are
 * at most 160 px on a side, so plain loops are fast enough.
 */
import { PNG } from 'pngjs';

import { CONNECTIONS } from '../analysis/geometry';
import type { Mask } from './pose-engine';

type LandmarkLike = readonly number[]; // [x, y] or [x, y, visibility], normalised

/** Low on purpose: blurring a guessed limb is better than exposing a real one. */
export const COVER_MIN_VIS = 0.2;

/**
 * The segmentation mask sometimes misses a limb or a foot, so when landmarks are
 * given, thick limb lines and a head disc are added to it. The result is grown by
 * `grow` x its longest side and feathered. The preview shows the live video while
 * the mask belongs to a frame one round trip older, so a tight mask would let a
 * moving arm or head slip out of the blur.
 */
export function encodeMask(
  mask: Mask,
  landmarks: readonly LandmarkLike[] | null = null,
  maxSide = 160,
  grow = 0.06,
): string {
  const { width: w, height: h } = mask;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const small = resizeArea(mask.data, w, h, sw, sh);
  let alpha: Uint8ClampedArray = new Uint8ClampedArray(sw * sh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.trunc(Math.min(1, Math.max(0, small[i])) * 255);
  if (landmarks?.length) coverSkeleton(alpha, sw, sh, landmarks);
  const k = Math.max(3, Math.round(Math.max(sw, sh) * grow)) | 1; // odd kernel size
  alpha = gaussianBlur(dilateEllipse(alpha, sw, sh, k), sw, sh, k);

  const png = new PNG({ width: sw, height: sh });
  for (let i = 0; i < alpha.length; i++) {
    png.data[i * 4] = 255;
    png.data[i * 4 + 1] = 255;
    png.data[i * 4 + 2] = 255;
    png.data[i * 4 + 3] = alpha[i];
  }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

/** Paint thick limbs and a head disc onto `alpha` (in place), from normalised landmarks. */
function coverSkeleton(alpha: Uint8ClampedArray, w: number, h: number, landmarks: readonly LandmarkLike[]): void {
  const pts = landmarks.map((lm) => [lm[0] * w, lm[1] * h] as const);
  const seen = landmarks.map((lm) => (lm.length > 2 ? lm[2] : 1) >= COVER_MIN_VIS);
  const thickness = Math.max(2, Math.round(Math.max(h, w) * 0.05));
  for (const [a, b] of CONNECTIONS) {
    if (seen[a] && seen[b]) stamp(alpha, w, h, (x, y) => distToSegment(x, y, pts[a], pts[b]), thickness / 2);
  }
  const head = [...Array(11).keys()].filter((i) => seen[i]); // face: nose, eyes, ears, mouth
  if (head.length) {
    const cx = head.reduce((s, i) => s + pts[i][0], 0) / head.length;
    const cy = head.reduce((s, i) => s + pts[i][1], 0) / head.length;
    let radius = thickness * 1.5;
    if (seen[11] && seen[12]) radius = Math.max(radius, 0.45 * Math.hypot(pts[11][0] - pts[12][0], pts[11][1] - pts[12][1]));
    if (seen[7] && seen[8]) radius = Math.max(radius, 0.9 * Math.hypot(pts[7][0] - pts[8][0], pts[7][1] - pts[8][1]));
    stamp(alpha, w, h, (x, y) => Math.hypot(x - cx, y - cy), Math.round(radius));
  }
}

/** Raise alpha to 255 inside `dist <= radius`, with a one-pixel anti-aliased edge. */
function stamp(alpha: Uint8ClampedArray, w: number, h: number, dist: (x: number, y: number) => number, radius: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cover = Math.min(1, Math.max(0, radius + 0.5 - dist(x, y)));
      if (cover > 0) alpha[y * w + x] = Math.max(alpha[y * w + x], Math.round(cover * 255));
    }
  }
}

function distToSegment(x: number, y: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** Area-averaging resize (OpenCV INTER_AREA for downscaling), separable. */
function resizeArea(src: Float32Array, w: number, h: number, dw: number, dh: number): Float32Array {
  const rows = new Float32Array(dw * h);
  const xw = areaWeights(w, dw);
  for (let y = 0; y < h; y++) {
    for (const [dx, sx, wt] of xw) rows[y * dw + dx] += src[y * w + sx] * wt;
  }
  const out = new Float32Array(dw * dh);
  for (const [dy, sy, wt] of areaWeights(h, dh)) {
    for (let x = 0; x < dw; x++) out[dy * dw + x] += rows[sy * dw + x] * wt;
  }
  return out;
}

/** [dst index, src index, weight] triples; each dst pixel's weights sum to 1. */
function areaWeights(n: number, dn: number): [number, number, number][] {
  const ratio = n / dn;
  const out: [number, number, number][] = [];
  for (let d = 0; d < dn; d++) {
    const start = d * ratio;
    const end = start + ratio;
    for (let s = Math.floor(start); s < Math.min(n, Math.ceil(end)); s++) {
      const overlap = Math.min(end, s + 1) - Math.max(start, s);
      if (overlap > 1e-9) out.push([d, s, overlap / ratio]);
    }
  }
  return out;
}

/** Max filter with an elliptical k x k kernel (cv2.MORPH_ELLIPSE). */
function dilateEllipse(src: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  const r = (k - 1) / 2;
  const offsets: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    // Same row extents as OpenCV: half-width of the ellipse at this row, rounded.
    const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((r + 0.5) * (r + 0.5)))));
    for (let dx = -half; dx <= half; dx++) offsets.push([dx, dy]);
  }
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (const [dx, dy] of offsets) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && src[yy * w + xx] > m) m = src[yy * w + xx];
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Separable Gaussian blur, k x k with OpenCV's default sigma, reflect-101 borders. */
function gaussianBlur(src: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  const sigma = 0.3 * ((k - 1) * 0.5 - 1) + 0.8;
  const r = (k - 1) / 2;
  const kernel = Array.from({ length: k }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  for (let i = 0; i < k; i++) kernel[i] /= sum;
  const reflect = (i: number, n: number) => {
    if (n === 1) return 0;
    while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
    return i;
  };
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = 0; i < k; i++) acc += src[y * w + reflect(x + i - r, w)] * kernel[i];
      tmp[y * w + x] = acc;
    }
  }
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = 0; i < k; i++) acc += tmp[reflect(y + i - r, h) * w + x] * kernel[i];
      out[y * w + x] = Math.round(acc);
    }
  }
  return out;
}
