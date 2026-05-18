import { Module } from '@nestjs/common';
import { AdminCourseService } from './admin-course.service';
import { AdminCourseController, AppCourseAdminController } from './admin-course.controller';
import { DatabaseModule } from '../../database/database.module';
import { SystemModule } from '../system/system.module';
import { CourseModule } from '../course/course.module';

@Module({
  imports: [DatabaseModule, SystemModule, CourseModule],
  controllers: [AdminCourseController, AppCourseAdminController],
  providers: [AdminCourseService],
  exports: [AdminCourseService],
})
export class AdminCourseModule {}
