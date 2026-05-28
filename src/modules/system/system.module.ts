import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { DatabaseModule } from '../../database/database.module';
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  imports: [DatabaseModule, MarketingModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}

