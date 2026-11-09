// The phone's part of the cross-device check (scripts/cross-device/run.mjs, plan item 12): the
// real engine and sync code against a live API server. Skipped unless run.mjs sets XD_DIR; it
// drives the phases through files in $XD_DIR/sig. "Offline" = every request fails, as with no network.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('../calendar', () => ({ getBusy: async () => [] }));
jest.mock('../notifications', () => ({
  MAX_PLANNED: 48,
  notificationsGranted: async () => true,
  cancelReminders: async () => {},
  scheduleReminders: async (planned: unknown[]) => planned.length,
}));
jest.mock('../board', () => ({ submitScore: jest.fn(async () => false) }));
// The session the API server gave this "phone" (run.mjs signs every client in with a test key).
jest.mock('../session', () => {
  let session: unknown = null;
  return {
    getSession: async () => {
      if (!session && process.env.XD_DIR) {
        const body = JSON.parse(require('node:fs').readFileSync(`${process.env.XD_DIR}/session-phone.json`, 'utf8'));
        session = {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: Date.now() + body.expires_in * 1000,
          user: { id: body.user.id, email: body.user.email, name: 'Cross Device', picture: '' },
        };
      }
      return session;
    },
  };
});
jest.mock('../../../../extension/config.js', () => ({
  ...jest.requireActual('../../../../extension/config.js'),
  API_URL: process.env.XD_API ?? 'http://127.0.0.1:18765',
}));

// The app's tsconfig has no Node types (like src/pose/analysis/__tests__/helpers.ts), so the few
// Node calls used here are typed by hand.
const { existsSync, writeFileSync } = require('node:fs') as {
  existsSync(path: string): boolean;
  writeFileSync(path: string, data: string): void;
};
type IncomingMessage = { statusCode: number; setEncoding(enc: string): void; on(ev: string, fn: (chunk?: string) => void): void };
type ClientRequest = { on(ev: string, fn: (err: Error) => void): void; write(body: string): void; end(): void };
const http = require('node:http') as {
  request(url: string, opts: { method: string; headers: Record<string, string> }, cb: (res: IncomingMessage) => void): ClientRequest;
};

import { breakDone, syncAccount } from '../engine';
import { getProfile, readLog, saveSettings } from '../store';
import { readOutbox } from '../sync';

const XD = process.env.XD_DIR;
const live = XD ? test : test.skip;
const sig = (name: string) => `${XD}/sig/${name}`;
const report = (name: string, data: unknown) => writeFileSync(sig(name), JSON.stringify(data));
async function waitFor(name: string, ms = 300_000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (existsSync(sig(name))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${name}`);
}

type MiniResponse = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };
type MiniInit = { method?: string; headers?: Record<string, string>; body?: string };

// Jest's React Native setup stubs fetch, so "online" is a small fetch over node:http: enough for
// sync.ts, which reads res.ok, res.status and res.json().
const nodeFetch = (url: string, init: MiniInit = {}): Promise<MiniResponse> =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk ?? '';
      });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text), text: async () => text });
      });
    });
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
const online = () => {
  globalThis.fetch = nodeFetch as unknown as typeof fetch;
};
const offline = () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Network request failed');
  }) as typeof fetch;
};

async function local() {
  const [profile, log, outbox] = await Promise.all([getProfile(), readLog(), readOutbox()]);
  const today = new Date().toDateString();
  return {
    xp: profile.xp,
    streak: profile.streak,
    breaks: log.length,
    today: log.filter((e) => new Date(e.at).toDateString() === today).length,
    devices: log.map((e) => (e as { device?: string }).device ?? 'ios'),
    outbox: outbox.length,
  };
}

live("phone: an offline break uploads once and the other devices' breaks arrive", async () => {
  try {
    online();
    await saveSettings({ setupDone: true, areas: ['Knees'] });
    report('phone-ready', { result: await syncAccount(), local: await local() });

    await waitFor('go-offline');
    offline();
    const before = await local();
    await breakDone(
      { scored: true, countedReps: 18, targetReps: 18, scores: [95, 90, 85], moves: [{ key: 'seated_knee_ext', area: 'Knees', completed: true }] },
      'seated_knee_ext',
    );
    const tried = await syncAccount(); // breakDone syncs too; with no network everything stays queued
    report('phone-offline-done', { before, after: await local(), syncWhileOffline: tried });

    await waitFor('phone-sync');
    online();
    report('phone-synced', { result: await syncAccount(), after: await local() });

    await waitFor('phone-final');
    report('phone-final-done', { result: await syncAccount(), after: await local() });
  } catch (err) {
    report('phone-error', { error: String((err as Error).stack ?? err) });
    throw err;
  }
}, 900_000);
