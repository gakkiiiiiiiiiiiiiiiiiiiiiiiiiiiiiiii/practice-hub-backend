import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { DatabaseModule } from '../../database/database.module';
import { MarketingModule } from '../marketing/marketing.module';
import { UserModule } from '../user/user.module';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [DatabaseModule, MarketingModule, UserModule, OrderModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
