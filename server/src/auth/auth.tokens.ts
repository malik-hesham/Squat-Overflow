/** Injection token for Google's ID-token signing keys (a jose key resolver). */
export const GOOGLE_KEYS = Symbol('GOOGLE_KEYS');
/** Injection token for the AuthService, or null when there is no database. */
export const AUTH_SERVICE = Symbol('AUTH_SERVICE');
