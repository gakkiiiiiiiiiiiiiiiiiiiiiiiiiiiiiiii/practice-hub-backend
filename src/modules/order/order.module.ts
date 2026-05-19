import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController, OrderPayNotifyController } from './order.controller';
import { DatabaseModule } from '../../database/database.module';
import { DistributorModule } from '../distributor/distributor.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    DatabaseModule,
    UploadModule,
    forwardRef(() => DistributorModule),
  ],
  controllers: [OrderController, OrderPayNotifyController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
