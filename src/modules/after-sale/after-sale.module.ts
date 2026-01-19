import { Module } from '@nestjs/common';
import { AfterSaleService } from './after-sale.service';
import { AfterSaleController, AdminAfterSaleController } from './after-sale.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AfterSaleController, AdminAfterSaleController],
  providers: [AfterSaleService],
})
export class AfterSaleModule {}
