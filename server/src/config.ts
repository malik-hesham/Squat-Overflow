import { join } from 'node:path';

/** Release tag baked into the Docker image (Dockerfile ARG VERSION); "dev" when run from source. */
export const VERSION = process.env.FORMCOACH_VERSION ?? 'dev';

/** The folder of exercise demo videos: server/demos (copied into the image), or FORMCOACH_DEMOS_DIR. */
export function demosDir(): string {
  return process.env.FORMCOACH_DEMOS_DIR ?? join(__dirname, '..', 'demos');
}

/**
 * Comma-separated list of exact origins, e.g. "chrome-extension://abcdef...". When set, it
 * replaces the defaults entirely. Unset = accept any Chrome or Firefox extension and loopback
 * pages (the VS Code extension serves its pages from http://127.0.0.1:<port>). Other web pages
 * get no CORS grant, so a site you visit can't call the API with your session.
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
