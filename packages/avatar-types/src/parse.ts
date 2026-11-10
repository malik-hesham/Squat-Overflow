/** The result of checking untrusted data (from the network, a message, a file). */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A finite number above 0. */
export function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** A number from 0 to 1, both included. */
export function isUnit(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/** One of `list`'s own entries (so 'toString' is never "one of" a list of names). */
export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function oneOfMessage(path: string, list: readonly string[]): string {
  return `${path}: must be one of ${list.join(', ')}`;
}
