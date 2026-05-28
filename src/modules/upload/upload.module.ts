import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController, AppUploadController, ProxyImageController } from './upload.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [UploadController, AppUploadController, ProxyImageController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
