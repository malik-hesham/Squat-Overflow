/** Per-process cap on open pose sessions (FORMCOACH_MAX_SESSIONS). */
import { Logger } from '@nestjs/common';

import { DEFAULT_MAX_SESSIONS, maxSessions } from '../../src/config';
import { Client, startServer, type Server } from './helpers';

const BUSY = { code: 1013, reason: 'server busy' };

describe('gateway with FORMCOACH_MAX_SESSIONS=2', () => {
  let server: Server;
  const open: Client[] = [];

  beforeAll(async () => {
    process.env.FORMCOACH_MAX_SESSIONS = '2'; // read when the gateway is created
    server = await startServer();
  });

  afterEach(async () => {
    const closing = open.splice(0);
    for (const c of closing) c.close();
    await Promise.all(closing.map((c) => c.closed()));
  });

  afterAll(async () => {
    delete process.env.FORMCOACH_MAX_SESSIONS;
    await server.app.close();
  });

  async function session(): Promise<Client> {
    const c = await Client.connect(server.ws);
    open.push(c);
    return c;
  }

  /** The server counts a session free once its own 'close' event runs, a moment after the client's. */
  async function sessionWhenFree(): Promise<{ client: Client; first: Awaited<ReturnType<Client['firstEvent']>> }> {
    for (let attempt = 0; ; attempt++) {
      const client = await session();
      const first = await client.firstEvent();
      if (!('code' in first) || attempt === 50) return { client, first };
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  test('accepts up to the cap, then closes new clients with 1013 before "ready"', async () => {
    const a = await session();
    const b = await session();
    expect(await a.firstEvent()).toMatchObject({ message: { type: 'ready' } });
    expect(await b.firstEvent()).toMatchObject({ message: { type: 'ready' } });

    const c = await session();
    expect(await c.firstEvent()).toEqual(BUSY);
  });

  test('a closed session frees its slot', async () => {
    const a = await session();
    const b = await session();
    await a.firstEvent();
    await b.firstEvent();
    expect(await (await session()).firstEvent()).toEqual(BUSY);

    a.close();
    await a.closed();
    const { first } = await sessionWhenFree();
    expect(first).toMatchObject({ message: { type: 'ready' } });
  });

  test('messages a refused client sent before the close arrived are dropped quietly', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error');
    try {
      const a = await session();
      const b = await session();
      await a.firstEvent();
      await b.firstEvent();

      // The extension sends config and privacy as soon as the socket opens, before the close lands.
      const c = await session();
      c.sendJson({ type: 'config', exercise: 'neck_tilt' });
      c.sendJson({ type: 'privacy', enabled: true });
      c.sendBytes(Buffer.from([0xff, 0xd8]));
      expect(await c.closed()).toEqual(BUSY);

      // The sessions that are in keep working.
      a.sendJson({ type: 'reset' });
      expect(await a.receive()).toMatchObject({ type: 'config', exercise: 'neck_tilt' });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('maxSessions', () => {
  test('defaults to 6 when unset or blank', () => {
    expect(DEFAULT_MAX_SESSIONS).toBe(6);
    expect(maxSessions(undefined)).toBe(6);
    expect(maxSessions(' ')).toBe(6);
  });

  test('reads a positive whole number', () => {
    expect(maxSessions('3')).toBe(3);
    expect(maxSessions(' 12 ')).toBe(12);
  });

  test('0 turns the cap off', () => {
    expect(maxSessions('0')).toBe(Infinity);
  });

  test.each(['abc', '-1', '2.5', '1e3', '6 sessions'])('refuses %p instead of running uncapped', (raw) => {
    expect(() => maxSessions(raw)).toThrow(/FORMCOACH_MAX_SESSIONS/);
  });
});
