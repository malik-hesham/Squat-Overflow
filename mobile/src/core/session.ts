// Google sign-in for the leaderboard: the phone's version of extension/lib/session.js.
//
// The app uses the extension's web OAuth client. Google returns the ID token to the server's
// /auth/mobile-callback page, which hands it to squatoverflow://auth. The app then posts the token
// to /auth/google with the raw nonce, as the extension does. Google only ever sees the nonce's
// hash, so another app that catches the redirect can't redeem the token.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as React from 'react';

import { API_URL, GOOGLE_CLIENT_ID } from '../../../extension/config.js';
import { requestSession } from '../../../extension/lib/session.js';

export type Session = Awaited<ReturnType<typeof requestSession>>;

const KEY = 'auth';
const REFRESH_MARGIN_MS = 60_000;
export const APP_REDIRECT = 'squatoverflow://auth';
export const CALLBACK_URL = `${API_URL}/auth/mobile-callback`;

/** The user closed the sign-in sheet; not an error worth showing. */
export class SignInCancelled extends Error {
  constructor() {
    super('Google sign-in was cancelled');
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Google's sign-in page for our web client. RN's URL.searchParams isn't reliable, so build the query by hand. */
export function signInUrl(hashedNonce: string): string {
  const params: Record<string, string> = {
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'id_token',
    redirect_uri: CALLBACK_URL,
    scope: 'openid email profile',
    nonce: hashedNonce,
    prompt: 'select_account',
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

/** The ID token from squatoverflow://auth?id_token=…, or null when Google sent an error or nothing. */
export function idTokenFrom(redirectUrl: string): string | null {
  const query = redirectUrl.includes('?') ? redirectUrl.slice(redirectUrl.indexOf('?') + 1) : '';
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
    params[decode(eq < 0 ? pair : pair.slice(0, eq))] = eq < 0 ? '' : decode(pair.slice(eq + 1));
  }
  if (params.error || !params.id_token) return null;
  return params.id_token;
}

// The session as last read or written; undefined until first loaded. Screens follow it through useSession().
let current: Session | null | undefined;
// Bumped by signOut(), so a refresh that finishes after sign-out doesn't sign the user back in.
let generation = 0;
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<() => void>();

function publish(session: Session | null) {
  current = session;
  listeners.forEach((l) => l());
}

async function load(): Promise<Session | null> {
  let session: Session | null = null;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    session = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    session = null;
  }
  if (current === undefined || current?.accessToken !== session?.accessToken) publish(session);
  return session;
}

async function store(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  publish(session);
}

export async function signIn(): Promise<Session> {
  const nonce = hex(Crypto.getRandomBytes(16));
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  const result = await WebBrowser.openAuthSessionAsync(signInUrl(hashed), APP_REDIRECT);
  if (result.type !== 'success') throw new SignInCancelled();
  const idToken = idTokenFrom(result.url);
  if (!idToken) throw new Error('Google sign-in failed');
  const session = await requestSession('/auth/google', { id_token: idToken, nonce }, API_URL);
  generation++;
  await store(session);
  return session;
}

async function refresh(stored: Session, gen: number): Promise<Session | null> {
  try {
    const next = await requestSession('/auth/refresh', { refresh_token: stored.refreshToken }, API_URL);
    if (gen !== generation) return null;
    await store(next);
    return next;
  } catch (err) {
    // The server refused the refresh token (spent or expired): the user has to sign in again.
    // Anything else (offline, server down) keeps the stored session for the next try.
    if (gen === generation && err instanceof Error && err.message === 'auth 401') await signOut();
    return null;
  }
}

/** A session with time left on its access token, refreshing it first if needed; null when signed out. */
export async function getSession(): Promise<Session | null> {
  const stored = await load();
  if (!stored?.accessToken) return null;
  if (stored.expiresAt - Date.now() > REFRESH_MARGIN_MS) return stored;
  // Refresh tokens are single-use, so callers that arrive together share one refresh.
  refreshing ??= refresh(stored, generation).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signOut(): Promise<void> {
  generation++;
  await SecureStore.deleteItemAsync(KEY);
  publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (current === undefined) void load();
  return () => {
    listeners.delete(listener);
  };
}

/** The stored session for rendering: undefined while loading, null when signed out. */
export function useSession(): Session | null | undefined {
  return React.useSyncExternalStore(subscribe, () => current);
}

/** For tests: forget the in-memory state between cases. */
export function resetSessionForTests() {
  current = undefined;
  generation = 0;
  refreshing = null;
  listeners.clear();
}
