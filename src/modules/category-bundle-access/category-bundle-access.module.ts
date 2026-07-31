import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CategoryBundleAccessService } from './category-bundle-access.service';

@Module({
  imports: [DatabaseModule],
  providers: [CategoryBundleAccessService],
  exports: [CategoryBundleAccessService],
})
export class CategoryBundleAccessModule {}
