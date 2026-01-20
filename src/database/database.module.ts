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
import { Distributor } from './entities/distributor.entity';
import { DistributionRelation } from './entities/distribution-relation.entity';
import { DistributionOrder } from './entities/distribution-order.entity';
import { DistributionConfig } from './entities/distribution-config.entity';
import { ExamConfig } from './entities/exam-config.entity';
import { ExamRecord } from './entities/exam-record.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { CourseRecommendation } from './entities/course-recommendation.entity';
import { Banner } from './entities/banner.entity';
import { PageRoute } from './entities/page-route.entity';
import { SystemConfig } from './entities/system-config.entity';
import { UserNote } from './entities/user-note.entity';
import { OrderAfterSale } from './entities/order-after-sale.entity';
import { CourseCategory } from './entities/course-category.entity';

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
			UserNote,
			UserCourseAuth,
			ActivationCode,
			Order,
			SysOperationLog,
			HomeRecommendCategory,
			HomeRecommendItem,
			Feedback,
			Distributor,
			DistributionRelation,
			DistributionOrder,
			DistributionConfig,
			ExamConfig,
			ExamRecord,
			Role,
			RolePermission,
			CourseRecommendation,
			Banner,
			PageRoute,
			SystemConfig,
			OrderAfterSale,
			CourseCategory,
		]),
	],
	exports: [TypeOrmModule],
})
export class DatabaseModule {}
