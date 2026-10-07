import { Module } from '@nestjs/common';
import { ZhiyePrintModule } from '../zhiye-print/zhiye-print.module';
import { ZhiyeMaterialsController } from './zhiye-materials.controller';
import { ZhiyeMaterialsService } from './zhiye-materials.service';

@Module({
  imports: [ZhiyePrintModule],
  controllers: [ZhiyeMaterialsController],
  providers: [ZhiyeMaterialsService],
})
export class ZhiyeMaterialsModule {}
