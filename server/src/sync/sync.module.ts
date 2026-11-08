import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DB } from '../db/database.module';
import type { Db } from '../db/db';
import { LeaderboardStore } from '../leaderboard/leaderboard.store';
import { MeController, SYNC_SERVICE, SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncStore } from './sync.store';

/** Cross-device sync. Without a database BearerGuard answers 503 before the service is used. */
@Module({
  imports: [AuthModule],
  controllers: [SyncController, MeController],
  providers: [
    {
      provide: SYNC_SERVICE,
      inject: [DB],
      useFactory: (db: Db | null) => (db ? new SyncService(new SyncStore(db), new LeaderboardStore(db)) : null),
    },
  ],
})
export class SyncModule {}
