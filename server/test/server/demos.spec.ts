/**
 * Exercise demo videos: GET /demos/<move>.mp4 serves server/demos/<move>.mp4 (made by
 * extension/scripts/make-demo-video.mjs, which also checks them). The clients show the drawn figure
 * when a move has no video.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer, type Server } from './helpers';

let server: Server;
let dir: string;
const video = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'so-demos-'));
  writeFileSync(join(dir, 'neck_tilt.mp4'), video);
  writeFileSync(join(dir, '.gitkeep'), '');
  writeFileSync(join(dir, 'notes.txt'), 'not a demo');
  process.env.FORMCOACH_DEMOS_DIR = dir;
  server = await startServer();
});

afterAll(async () => {
  await server.app.close();
  delete process.env.FORMCOACH_DEMOS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test("a move's demo video comes back as video/mp4 that players can seek in and cache, with no cookie", async () => {
  const res = await fetch(`${server.http}/demos/neck_tilt.mp4`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('video/mp4');
  expect(res.headers.get('accept-ranges')).toBe('bytes');
  expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(Buffer.from(await res.arrayBuffer())).toEqual(video);
});

test('a byte range comes back as 206 Partial Content: iPhones ask for ranges before they play', async () => {
  const res = await fetch(`${server.http}/demos/neck_tilt.mp4`, { headers: { Range: 'bytes=0-1' } });
  expect(res.status).toBe(206);
  expect(res.headers.get('content-range')).toBe('bytes 0-1/10000');
  expect(Buffer.from(await res.arrayBuffer())).toEqual(video.subarray(0, 2));
});

test('a move with no video, a hidden file, another kind of file or a path trick is 404', async () => {
  for (const path of [
    'chin_tuck.mp4',
    '.gitkeep',
    'notes.txt',
    'NECK_TILT.mp4',
    '..%2Fpackage.json',
    '%2e%2e%2Fpackage.json',
    '..%2F..%2Fpackage.json',
  ]) {
    const res = await fetch(`${server.http}/demos/${path}`);
    expect([path, res.status]).toEqual([path, 404]);
  }
});

test('the privacy policy says demo videos come from the server and that the request carries no account details', async () => {
  const text = await (await fetch(`${server.http}/privacy`)).text();
  expect(text).toContain('demo video');
  expect(text).toMatch(/no account details/);
  expect(text).not.toContain('nothing is loaded from the internet to show it');
});
