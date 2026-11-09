import { Global, Inject, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

import type { Db } from './db';
import { migrate } from './migrate';

/** Injection token for the Postgres client: a pg Pool from DATABASE_URL, or null when it is unset. */
export const DB = Symbol('DB');

/** Applies pending migrations at startup and closes the pool at shutdown. */
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(@Inject(DB) private readonly db: Db | null) {}

  async onModuleInit(): Promise<void> {
    if (!this.db) {
      this.logger.warn('DATABASE_URL is not set: sign-in and the leaderboard answer 503');
      return;
    }
    // A pool hands out a different connection per query; the migration lock needs one session.
    const client: PoolClient | null = this.db instanceof Pool ? await this.db.connect() : null;
    try {
      const applied = await migrate(client ?? this.db);
      if (applied.length) this.logger.log(`applied migrations: ${applied.join(', ')}`);
    } finally {
      client?.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.db instanceof Pool) await this.db.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db | null =>
        process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }) : null,
    },
    DatabaseLifecycle,
  ],
  exports: [DB],
})
export class DatabaseModule {}
