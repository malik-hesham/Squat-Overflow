import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './db/database.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { PoseGateway } from './pose/pose.gateway';

@Module({
  imports: [DatabaseModule, AuthModule, LeaderboardModule],
  controllers: [AppController],
  providers: [PoseGateway],
})
export class AppModule {}
