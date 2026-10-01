import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CloudPrintModule } from '../cloud-print/cloud-print.module';
import { UploadModule } from '../upload/upload.module';
import { ZhiyePrintController } from './zhiye-print.controller';
import { ZhiyePrintService } from './zhiye-print.service';
import { ZhiyeCheckoutController } from './zhiye-checkout.controller';
import { ZhiyeCheckoutService } from './zhiye-checkout.service';
import { ZhiyeAppGuard } from './zhiye-app.guard';
import { ZhiyePrintRenderController } from './zhiye-print-render.controller';

@Module({
  imports: [DatabaseModule, UploadModule, CloudPrintModule],
  controllers: [ZhiyePrintController, ZhiyeCheckoutController, ZhiyePrintRenderController],
  providers: [ZhiyePrintService, ZhiyeCheckoutService, ZhiyeAppGuard],
  exports: [ZhiyePrintService, ZhiyeAppGuard],
})
export class ZhiyePrintModule {}
