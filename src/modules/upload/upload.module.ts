import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController, AppUploadController } from './upload.controller';

@Module({
  controllers: [UploadController, AppUploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}

