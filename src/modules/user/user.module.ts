import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { CheckinService } from './checkin.service';
import { DatabaseModule } from '../../database/database.module';
import { OrderModule } from '../order/order.module';
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => OrderModule), MarketingModule],
  controllers: [UserController],
  providers: [UserService, CheckinService],
  exports: [UserService, CheckinService],
})
export class UserModule {}

