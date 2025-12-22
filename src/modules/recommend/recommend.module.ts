import { Module } from '@nestjs/common';
import { RecommendService } from './recommend.service';
import { RecommendController } from './recommend.controller';
import { AppRecommendController } from './app-recommend.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [RecommendController, AppRecommendController],
  providers: [RecommendService],
  exports: [RecommendService],
})
export class RecommendModule {}

