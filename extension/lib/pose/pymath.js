/**
 * Numeric helpers that reproduce CPython's float semantics, so this JavaScript
 * port of the pose analysis gives the same numbers as the Python server.
 *
 * Why this matters: frame results are rounded to 0.1 degree and rep durations
 * to 0.01 s, and thresholds are compared with `>=`/`<=`. Python's `round()`
 * rounds half to even on the exact binary value, `sum()` of floats is
 * compensated (Python 3.12+), and `math.hypot()` is correctly rounded. Naive JS
 * equivalents differ in the last bit or on ties, which is enough to flip a
 * rounded value or a threshold now and then.
 */

/** `math.degrees` multiplies by this constant (CPython: `x * radToDeg`). */
export const RAD_TO_DEG = 180.0 / Math.PI;

/** `math.radians` multiplies by this constant. */
export const DEG_TO_RAD = Math.PI / 180.0;

/** @param {number} x */
export function degrees(x) {
  return x * RAD_TO_DEG;
}

/** @param {number} x */
export function radians(x) {
  return x * DEG_TO_RAD;
}

/**
 * Python's `round(x, ndigits)` for floats (ndigits >= 0).
 *
 * CPython rounds the exact binary value of `x` to `ndigits` decimals, half to
 * even, then parses the decimal back. `Number.prototype.toFixed` also works on
 * the exact value, but breaks ties away from zero. An exact tie at `ndigits`
 * decimals is only possible when `x * 2^(ndigits + 1)` is an odd integer
 * (e.g. 0.25 for one decimal, 0.125 for two), so those are handled apart.
 * @param {number} x
 * @param {number} [ndigits]
 */
export function pyRound(x, ndigits = 0) {
  if (!Number.isFinite(x)) return x;
  const q = x * 2 ** (ndigits + 1); // exact: scaling by a power of two
  if (Number.isInteger(q) && q % 2 !== 0) {
    const p = 10 ** ndigits;
    const scaled = x * p; // exact: a half-integer well inside 2^53
    const lo = Math.floor(scaled);
    return (lo % 2 === 0 ? lo : lo + 1) / p;
  }
  return Number(x.toFixed(ndigits));
}

/**
 * Python 3.12+ `sum()` over floats: Neumaier compensated summation, starting
 * from the integer 0 (so the first item is taken as-is).
 * @param {readonly number[]} xs
 */
export function pySum(xs) {
  if (xs.length === 0) return 0;
  let f = 0 + xs[0];
  let c = 0.0;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) {
      c += f - t + x;
    } else {
      c += x - t + f;
    }
    f = t;
  }
  // Avoid losing the sign on a negative result, and don't let the
  // compensation turn an infinite sum into NaN.
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

/** Python's `statistics.median`.
 * @param {readonly number[]} data
 */
export function median(data) {
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error("no median for empty data");
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  const i = n / 2;
  return (sorted[i - 1] + sorted[i]) / 2;
}

// --- math.hypot -------------------------------------------------------------

// Port of CPython's `vector_norm` (Modules/mathmodule.c), which is correctly
// rounded in all but rare cases. `Math.hypot` / `Math.sqrt(x*x + y*y)` differ
// from it in the last bit for roughly one input in six.
const VELTKAMP = 134217729.0; // 2^27 + 1

/** Error-free product: [hi, lo] with hi = fl(x*y) and hi + lo == x*y exactly. */
function twoProduct(x, y) {
  const z = x * y;
  let t = VELTKAMP * x;
  const xh = t - (t - x);
  const xl = x - xh;
  t = VELTKAMP * y;
  const yh = t - (t - y);
  const yl = y - yh;
  const zz = xh * yh - z + xh * yl + xl * yh + xl * yl;
  return [z, zz];
}

/** Compensated sum of two floats, |a| >= |b|. */
function fastTwoSum(a, b) {
  const x = a + b;
  const y = a - x + b;
  return [x, y];
}

/** Exponent e of frexp(v): v = m * 2^e with 0.5 <= m < 1 (v finite, > 0, normal). */
function frexpExponent(v) {
  let e = Math.floor(Math.log2(v)) + 1;
  let m = v / 2 ** e;
  while (m >= 1) {
    e += 1;
    m /= 2;
  }

  while (m < 0.5) {
    e -= 1;
    m *= 2;
  }
  return e;
}

/** Python's `math.hypot(x, y)`.
 * @param {number} x
 * @param {number} y
 */
export function pyHypot(x, y) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (Number.isNaN(ax) || Number.isNaN(ay)) return NaN;
  const max = ax > ay ? ax : ay;
  if (max === 0) return max;
  if (max < 2.2250738585072014e-308) return Math.hypot(ax, ay); // subnormals: not reachable for poses
  const scale = 2 ** -frexpExponent(max);
  let csum = 1.0;
  let frac1 = 0.0;
  let frac2 = 0.0;
  for (const v of [ax, ay]) {
    const s = v * scale; // lossless scaling
    const [phi, plo] = twoProduct(s, s); // lossless squaring
    const [shi, slo] = fastTwoSum(csum, phi); // lossless addition
    csum = shi;
    frac1 += plo;
    frac2 += slo;
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
  const [phi, plo] = twoProduct(-h, h);
  const [shi, slo] = fastTwoSum(csum, phi);
  csum = shi;
  frac1 += plo;
  frac2 += slo;
  const r = csum - 1.0 + (frac1 + frac2);
  h += r / (2.0 * h); // differential correction
  return h / scale;
}
