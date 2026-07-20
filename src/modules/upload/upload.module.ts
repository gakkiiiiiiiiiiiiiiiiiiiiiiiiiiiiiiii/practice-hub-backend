import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController, AppUploadController, ProxyImageController } from './upload.controller';
import { DatabaseModule } from '../../database/database.module';
import { StorageProviderService } from './storage-provider.service';

@Module({
  imports: [DatabaseModule],
  controllers: [UploadController, AppUploadController, ProxyImageController],
	providers: [UploadService, StorageProviderService],
	exports: [UploadService, StorageProviderService],
})
export class UploadModule {}
