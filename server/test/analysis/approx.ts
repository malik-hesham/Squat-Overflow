/**
 * `pytest.approx` for jest: |actual - expected| <= tolerance, where the
 * tolerance is `abs` when only `abs` is given, else max(rel * |expected|, abs)
 * with pytest's defaults rel = 1e-6, abs = 1e-12.
 */
export function expectApprox(actual: number | null | undefined, expected: number, opts: { abs?: number; rel?: number } = {}): void {
  const tol =
    opts.rel === undefined && opts.abs !== undefined
      ? opts.abs
      : Math.max((opts.rel ?? 1e-6) * Math.abs(expected), opts.abs ?? 1e-12);
  expect(typeof actual).toBe('number');
  const diff = Math.abs(expected - (actual as number));
  if (!(diff <= tol)) {
    throw new Error(`expected ${String(actual)} to be ${expected} ± ${tol}`);
  }
}
