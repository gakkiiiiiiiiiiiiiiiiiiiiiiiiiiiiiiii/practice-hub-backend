import { Module } from '@nestjs/common';
import { BannerService } from './banner.service';
import { BannerController } from './banner.controller';
import { AppBannerController } from './app-banner.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
	imports: [DatabaseModule],
	controllers: [BannerController, AppBannerController],
	providers: [BannerService],
	exports: [BannerService],
})
export class BannerModule {}
