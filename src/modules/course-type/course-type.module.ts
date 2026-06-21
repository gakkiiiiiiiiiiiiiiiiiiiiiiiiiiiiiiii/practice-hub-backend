import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CourseTypeController } from './course-type.controller';
import { CourseTypeService } from './course-type.service';

@Module({
	imports: [DatabaseModule],
	controllers: [CourseTypeController],
	providers: [CourseTypeService],
	exports: [CourseTypeService],
})
export class CourseTypeModule {}
