import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './db/database.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [DatabaseModule, AuthModule, LeaderboardModule, SyncModule],
  controllers: [AppController],
})
export class AppModule {}
