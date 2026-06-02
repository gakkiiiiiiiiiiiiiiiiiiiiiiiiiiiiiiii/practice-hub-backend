import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { DatabaseModule } from '../../database/database.module';
import { MarketingModule } from '../marketing/marketing.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [DatabaseModule, MarketingModule, UserModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}

