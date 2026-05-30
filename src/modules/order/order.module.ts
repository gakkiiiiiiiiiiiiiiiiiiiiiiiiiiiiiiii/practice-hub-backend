import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController, OrderPayNotifyController, WechatXpayNotifyController, AdminOrderController } from './order.controller';
import { DatabaseModule } from '../../database/database.module';
import { DistributorModule } from '../distributor/distributor.module';
import { XpayService } from './xpay.service';
import { CoinService } from './coin.service';
import { MarketingModule } from '../marketing/marketing.module';
import { PackageModule } from '../package/package.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => DistributorModule), MarketingModule, PackageModule],
  controllers: [OrderController, OrderPayNotifyController, WechatXpayNotifyController, AdminOrderController],
  providers: [OrderService, XpayService, CoinService],
  exports: [OrderService, XpayService, CoinService],
})
export class OrderModule {}
