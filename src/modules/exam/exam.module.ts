import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamConfig } from '../../database/entities/exam-config.entity';
import { ExamRecord } from '../../database/entities/exam-record.entity';
import { Question } from '../../database/entities/question.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Course } from '../../database/entities/course.entity';
import { ExamService } from './exam.service';
import { ExamController } from './exam.controller';
import { AdminExamController } from './admin-exam.controller';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			ExamConfig,
			ExamRecord,
			Question,
			Chapter,
			Course,
		]),
	],
	controllers: [ExamController, AdminExamController],
	providers: [ExamService],
	exports: [ExamService],
})
export class ExamModule {}
