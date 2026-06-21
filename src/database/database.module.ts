import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysUser } from './entities/sys-user.entity';
import { AppUser } from './entities/app-user.entity';
import { AppUserSession } from './entities/app-user-session.entity';
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
import { UserCheckin } from './entities/user-checkin.entity';
import { UserFileCourseProgress } from './entities/user-file-course-progress.entity';
import { PreviewCacheTask } from './entities/preview-cache-task.entity';
import { CourseFile } from './entities/course-file.entity';
import { CourseType } from './entities/course-type.entity';
import { UserReferral } from './entities/user-referral.entity';
import { UserCoupon } from './entities/user-coupon.entity';
import { UserPointsLog } from './entities/user-points-log.entity';
import { PackageSection } from './entities/package-section.entity';
import { PackageSectionScope } from './entities/package-section-scope.entity';
import { PackagePlan } from './entities/package-plan.entity';
import { UserPackageSubscription } from './entities/user-package-subscription.entity';
import { CoinTransaction } from './entities/coin-transaction.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			SysUser,
			AppUser,
			AppUserSession,
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
			UserCheckin,
			UserFileCourseProgress,
			PreviewCacheTask,
			CourseFile,
			CourseType,
			UserReferral,
			UserCoupon,
			UserPointsLog,
			PackageSection,
			PackageSectionScope,
			PackagePlan,
			UserPackageSubscription,
			CoinTransaction,
		]),
	],
	exports: [TypeOrmModule],
})
export class DatabaseModule {}
