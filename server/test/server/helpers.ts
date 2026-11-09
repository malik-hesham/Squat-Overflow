import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';

import { createApp } from '../../src/main';

export const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export interface Server {
  app: INestApplication;
  http: string;
}

export async function startServer(): Promise<Server> {
  const app = await createApp(['error']);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, http: `http://127.0.0.1:${port}` };
}
