import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminCourseCategoryController } from './admin-course-category.controller';
import { AdminCourseCategoryService } from './admin-course-category.service';

@Module({
	imports: [DatabaseModule],
	controllers: [AdminCourseCategoryController],
	providers: [AdminCourseCategoryService],
})
export class AdminCourseCategoryModule {}
