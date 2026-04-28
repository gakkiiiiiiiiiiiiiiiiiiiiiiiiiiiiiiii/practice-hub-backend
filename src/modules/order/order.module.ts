import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController, OrderPayNotifyController } from './order.controller';
import { DatabaseModule } from '../../database/database.module';
import { DistributorModule } from '../distributor/distributor.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => DistributorModule),
  ],
  controllers: [OrderController, OrderPayNotifyController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
