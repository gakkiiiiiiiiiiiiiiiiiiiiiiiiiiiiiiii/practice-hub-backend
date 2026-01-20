import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Course } from '../../database/entities/course.entity';
import { AdminCourseCategoryController } from './admin-course-category.controller';
import { AdminCourseCategoryService } from './admin-course-category.service';

@Module({
	imports: [TypeOrmModule.forFeature([CourseCategory, Course])],
	controllers: [AdminCourseCategoryController],
	providers: [AdminCourseCategoryService],
})
export class AdminCourseCategoryModule {}
