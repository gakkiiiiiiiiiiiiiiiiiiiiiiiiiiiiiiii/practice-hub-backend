import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController, AppUploadController, ProxyImageController } from './upload.controller';

@Module({
  controllers: [UploadController, AppUploadController, ProxyImageController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}

