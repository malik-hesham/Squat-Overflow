import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import WebSocket from 'ws';

import { createApp } from '../../src/main';

export const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export interface Server {
  app: INestApplication;
  http: string;
  ws: string;
}

export async function startServer(): Promise<Server> {
  const app = await createApp(['error']);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

/** A ws client that queues incoming JSON so tests can await replies in order. */
export class Client {
  private readonly queue: unknown[] = [];
  private readonly waiters: ((msg: unknown) => void)[] = [];
  private readonly closedPromise: Promise<{ code: number; reason: string }>;

  private constructor(readonly socket: WebSocket) {
    this.closedPromise = new Promise((resolve) =>
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  static connect(url: string, origin: string | undefined = EXT): Promise<Client> {
    const socket = new WebSocket(url, origin ? { origin } : {});
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(new Client(socket)));
      socket.once('unexpected-response', (_req, res) => reject(new Error(`handshake refused: ${res.statusCode}`)));
      socket.once('error', reject);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  receive(): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  sendJson(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  sendBytes(data: Buffer): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  /** Resolves with the close code and reason once the socket has closed, from either side. */
  closed(): Promise<{ code: number; reason: string }> {
    return this.closedPromise;
  }

  /** The first thing the server does after the handshake: send a message, or close the socket. */
  firstEvent(): Promise<{ message: unknown } | { code: number; reason: string }> {
    return Promise.race([this.receive().then((message) => ({ message })), this.closed()]);
  }
}

export function jpeg(width: number, height: number, gray = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: gray, g: gray, b: gray } } })
    .jpeg()
    .toBuffer();
}
