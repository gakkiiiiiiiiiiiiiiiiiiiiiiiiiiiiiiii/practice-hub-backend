import { Module } from '@nestjs/common';
import { RecommendService } from './recommend.service';
import { RecommendController } from './recommend.controller';
import { AppRecommendController } from './app-recommend.controller';
import { DatabaseModule } from '../../database/database.module';
import { UploadModule } from '../upload/upload.module';
import { CategoryBundleAccessModule } from '../category-bundle-access/category-bundle-access.module';

@Module({
  imports: [DatabaseModule, UploadModule, CategoryBundleAccessModule],
  controllers: [RecommendController, AppRecommendController],
  providers: [RecommendService],
  exports: [RecommendService],
})
export class RecommendModule {}
