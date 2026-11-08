import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { PoseGateway } from './pose/pose.gateway';

@Module({
  controllers: [AppController],
  providers: [PoseGateway],
})
export class AppModule {}
