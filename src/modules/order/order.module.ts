import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController, OrderPayNotifyController } from './order.controller';
import { DatabaseModule } from '../../database/database.module';
import { DistributorModule } from '../distributor/distributor.module';
import { UploadModule } from '../upload/upload.module';
import { VirtualPayGoodsService } from './virtual-pay-goods.service';
import { VirtualPayGoodsSyncScheduler } from './virtual-pay-goods-sync.scheduler';
import { CoinService } from './coin.service';
import { MarketingModule } from '../marketing/marketing.module';
import { PackageModule } from '../package/package.module';

@Module({
  imports: [
    DatabaseModule,
    UploadModule,
    forwardRef(() => DistributorModule),
    MarketingModule,
    PackageModule,
  ],
  controllers: [OrderController, OrderPayNotifyController],
  providers: [OrderService, VirtualPayGoodsService, VirtualPayGoodsSyncScheduler, CoinService],
  exports: [OrderService, VirtualPayGoodsService, CoinService],
})
export class OrderModule {}
