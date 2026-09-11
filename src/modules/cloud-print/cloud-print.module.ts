import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminCloudPrintController, CloudPrintCallbackController } from './cloud-print.controller';
import { CloudPrintService } from './cloud-print.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [DatabaseModule, UploadModule],
  controllers: [AdminCloudPrintController, CloudPrintCallbackController],
  providers: [CloudPrintService],
  exports: [CloudPrintService],
})
export class CloudPrintModule {}
