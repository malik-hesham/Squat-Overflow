import { Module } from '@nestjs/common';

import { DemosController } from './demos.controller';

@Module({ controllers: [DemosController] })
export class DemosModule {}
