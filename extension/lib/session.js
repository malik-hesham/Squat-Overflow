import { API_URL, GOOGLE_CLIENT_ID } from "../config.js";
import { buildSignInUrl, parseSignInResponse, newNonce, sha256Hex, toSession } from "./auth.js";

const KEY = "auth";

/** @typedef {ReturnType<typeof toSession>} Session */

/** POSTs to the API server's auth API (/auth/google or /auth/refresh) and maps the reply to a stored session. */
export async function requestSession(path, body, base = API_URL) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth ${res.status}`);
  return toSession(await res.json(), Date.now());
}

export async function signIn({ calendar = false } = {}) {
  const nonce = newNonce();
  const redirect = await chrome.identity.launchWebAuthFlow({
    url: buildSignInUrl(GOOGLE_CLIENT_ID, chrome.identity.getRedirectURL(), await sha256Hex(nonce), calendar),
    interactive: true,
  });
  const google = redirect ? parseSignInResponse(redirect, Date.now()) : null;
  if (!google) throw new Error("Google sign-in was cancelled");
  // Google got the hash of the nonce; the server checks the token's nonce against this raw one.
  const session = await requestSession("/auth/google", { id_token: google.idToken, nonce });
  await chrome.storage.local.set({
    [KEY]: session,
    ...(calendar ? { calendar: { connected: true, token: google.accessToken, expiresAt: google.expiresAt } } : {}),
  });
  return session;
}

export async function getSession() {
  /** @type {{ [KEY]?: Session }} */
  const { [KEY]: stored } = await chrome.storage.local.get(KEY);
  if (!stored?.accessToken) return null;
  if (stored.expiresAt - Date.now() > 60_000) return stored;
  try {
    const next = await requestSession("/auth/refresh", { refresh_token: stored.refreshToken });
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  } catch {
    return null;
  }
}

export function signOut() {
  return chrome.storage.local.remove(KEY);
}
