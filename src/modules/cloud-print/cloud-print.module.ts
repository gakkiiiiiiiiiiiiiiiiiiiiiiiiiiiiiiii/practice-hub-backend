import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminCloudPrintController, CloudPrintCallbackController } from './cloud-print.controller';
import { CloudPrintService } from './cloud-print.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminCloudPrintController, CloudPrintCallbackController],
  providers: [CloudPrintService],
  exports: [CloudPrintService],
})
export class CloudPrintModule {}
