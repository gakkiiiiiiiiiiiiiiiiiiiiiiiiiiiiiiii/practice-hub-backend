import { Module } from '@nestjs/common';
import { HomeService } from './home.service';
import { HomeController } from './home.controller';
import { BannerModule } from '../banner/banner.module';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [BannerModule, SystemModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}

