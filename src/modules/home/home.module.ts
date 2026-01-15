import { Module } from '@nestjs/common';
import { HomeService } from './home.service';
import { HomeController } from './home.controller';
import { BannerModule } from '../banner/banner.module';

@Module({
  imports: [BannerModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}

