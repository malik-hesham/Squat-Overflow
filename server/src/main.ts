import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { INestApplication, LogLevel } from '@nestjs/common';

import { AppModule } from './app.module';
import { PoseWsAdapter } from './pose/protocol';

/** Builds the app without listening, so tests can drive it on an ephemeral port. */
export async function createApp(
  logger: LogLevel[] | false = ['error', 'warn', 'log'],
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger });
  app.useWebSocketAdapter(new PoseWsAdapter(app));
  app.enableShutdownHooks();
  return app;
}

async function main(): Promise<void> {
  const app = await createApp();
  const host = process.env.FORMCOACH_HOST ?? '127.0.0.1';
  const port = Number(process.env.FORMCOACH_PORT ?? process.env.PORT ?? 8765);
  await app.listen(port, host);
  console.log(`FormCoach pose server (NestJS) on http://${host}:${port}  ws path /ws`);
}

if (require.main === module) void main();
