import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysUser } from './entities/sys-user.entity';
import { AppUser } from './entities/app-user.entity';
import { Course } from './entities/course.entity';
import { Chapter } from './entities/chapter.entity';
import { Question } from './entities/question.entity';
import { UserAnswerLog } from './entities/user-answer-log.entity';
import { UserWrongBook } from './entities/user-wrong-book.entity';
import { UserCollection } from './entities/user-collection.entity';
import { UserCourseAuth } from './entities/user-course-auth.entity';
import { ActivationCode } from './entities/activation-code.entity';
import { Order } from './entities/order.entity';
import { SysOperationLog } from './entities/sys-operation-log.entity';
import { HomeRecommendCategory } from './entities/home-recommend-category.entity';
import { HomeRecommendItem } from './entities/home-recommend-item.entity';
import { Feedback } from './entities/feedback.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			SysUser,
			AppUser,
			Course,
			Chapter,
			Question,
			UserAnswerLog,
			UserWrongBook,
			UserCollection,
			UserCourseAuth,
			ActivationCode,
			Order,
			SysOperationLog,
			HomeRecommendCategory,
			HomeRecommendItem,
			Feedback,
		]),
	],
	exports: [TypeOrmModule],
})
export class DatabaseModule {}
