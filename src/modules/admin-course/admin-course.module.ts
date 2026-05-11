import { Module } from '@nestjs/common';
import { AdminCourseService } from './admin-course.service';
import { AdminCourseController } from './admin-course.controller';
import { DatabaseModule } from '../../database/database.module';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [DatabaseModule, SystemModule],
  controllers: [AdminCourseController],
  providers: [AdminCourseService],
  exports: [AdminCourseService],
})
export class AdminCourseModule {}
