/** Release tag baked into the Docker image (Dockerfile ARG VERSION); "dev" when run from source. */
export const VERSION = process.env.FORMCOACH_VERSION ?? 'dev';

/** Frames above this get an error reply; the socket itself caps messages at WS_MAX_PAYLOAD. */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const WS_MAX_PAYLOAD = 3_000_000;

/**
 * Open pose sessions one process accepts. Each holds a WebSocket and, once frames arrive, a
 * BlazePose detector, and inference for all of them shares one event loop, so past ~6 every
 * session slows down. Clients over the cap are closed with 1013 (Try Again Later).
 */
export const DEFAULT_MAX_SESSIONS = 6;

/** FORMCOACH_MAX_SESSIONS: a whole number, 0 = no cap, unset = DEFAULT_MAX_SESSIONS. Throws on anything else. */
export function maxSessions(raw: string | undefined = process.env.FORMCOACH_MAX_SESSIONS): number {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_MAX_SESSIONS;
  if (!/^\d+$/.test(value)) throw new Error(`FORMCOACH_MAX_SESSIONS must be a whole number (0 = no cap), got ${JSON.stringify(raw)}`);
  const n = Number(value);
  return n === 0 ? Infinity : n;
}

/**
 * Comma-separated list of exact origins, e.g. "chrome-extension://abcdef...". When set, it
 * replaces the defaults entirely. Unset = accept any Chrome or Firefox extension and loopback
 * pages (the VS Code extension serves its pages from http://127.0.0.1:<port>). Other web pages
 * are refused, so a site you visit can't stream frames to (or read results from) this server.
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = parseOrigins(process.env.FORMCOACH_ALLOWED_ORIGINS);

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/;

export function parseOrigins(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((o) => o.trim()).filter(Boolean));
}

export function originAllowed(origin: string | undefined, allowed: ReadonlySet<string> = ALLOWED_ORIGINS): boolean {
  if (origin === undefined) return true; // non-browser client (tests, scripts); browsers always send Origin
  if (allowed.size > 0) return allowed.has(origin);
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) return true;
  return LOOPBACK_ORIGIN.test(origin);
}
