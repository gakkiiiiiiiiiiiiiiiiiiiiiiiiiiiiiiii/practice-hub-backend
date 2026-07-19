import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feedback } from '../../database/entities/feedback.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { AdminFeedbackController } from './admin-feedback.controller';
import { UploadModule } from '../upload/upload.module';

@Module({
	imports: [TypeOrmModule.forFeature([Feedback]), UploadModule],
	controllers: [FeedbackController, AdminFeedbackController],
	providers: [FeedbackService],
	exports: [FeedbackService],
})
export class FeedbackModule {}
