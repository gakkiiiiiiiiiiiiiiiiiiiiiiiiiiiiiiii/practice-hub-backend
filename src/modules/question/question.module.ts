import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { DatabaseModule } from '../../database/database.module';
import { PackageModule } from '../package/package.module';
import { CategoryBundleAccessModule } from '../category-bundle-access/category-bundle-access.module';

@Module({
  imports: [DatabaseModule, PackageModule, CategoryBundleAccessModule],
  controllers: [QuestionController],
  providers: [QuestionService],
  exports: [QuestionService],
})
export class QuestionModule {}
