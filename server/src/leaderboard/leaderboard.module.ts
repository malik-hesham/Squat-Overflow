import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DB } from '../db/database.module';
import type { Db } from '../db/db';
import { LEADERBOARD_STORE, LeaderboardController } from './leaderboard.controller';
import { LeaderboardStore } from './leaderboard.store';

@Module({
  imports: [AuthModule],
  controllers: [LeaderboardController],
  providers: [
    { provide: LEADERBOARD_STORE, inject: [DB], useFactory: (db: Db | null) => (db ? new LeaderboardStore(db) : null) },
  ],
})
export class LeaderboardModule {}
