import { Module } from '@nestjs/common';
import { AdminCourseService } from './admin-course.service';
import { PreviewCacheMaintenanceService } from './preview-cache-maintenance.service';
import { AdminCourseController, AppCourseAdminController } from './admin-course.controller';
import { DatabaseModule } from '../../database/database.module';
import { SystemModule } from '../system/system.module';
import { CourseModule } from '../course/course.module';
import { SystemRoleModule } from '../system-role/system-role.module';

@Module({
  imports: [DatabaseModule, SystemModule, CourseModule, SystemRoleModule],
  controllers: [AdminCourseController, AppCourseAdminController],
  providers: [AdminCourseService, PreviewCacheMaintenanceService],
  exports: [AdminCourseService, PreviewCacheMaintenanceService],
})
export class AdminCourseModule {}
