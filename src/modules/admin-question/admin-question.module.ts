import { Module } from '@nestjs/common';
import { AdminQuestionService } from './admin-question.service';
import { AdminQuestionController } from './admin-question.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminQuestionController],
  providers: [AdminQuestionService],
})
export class AdminQuestionModule {}

