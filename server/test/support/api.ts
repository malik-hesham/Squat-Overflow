import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { JWTVerifyGetKey } from 'jose';

import { AppModule } from '../../src/app.module';
import { GOOGLE_KEYS } from '../../src/auth/auth.module';
import { DB } from '../../src/db/database.module';
import type { Db } from '../../src/db/db';
import { configureApp } from '../../src/main';
import { CLIENT_ID } from './google';

export interface ApiServer {
  app: INestApplication;
  url: string;
}

/** The whole app on an ephemeral port, with an in-process Postgres and fake Google keys. */
export async function startApi(db: Db, googleKeys: JWTVerifyGetKey): Promise<ApiServer> {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.AUTH_JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB)
    .useValue(db)
    .overrideProvider(GOOGLE_KEYS)
    .useValue(googleKeys)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error'] }));
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

export async function call(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
