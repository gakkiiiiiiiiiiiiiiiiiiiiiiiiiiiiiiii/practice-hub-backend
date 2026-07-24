import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ReferralCouponService } from './referral-coupon.service';
import { PointsService } from './points.service';
import { MarketingController } from './marketing.controller';
import { RewardedAdService } from './rewarded-ad.service';

@Module({
	imports: [DatabaseModule],
	controllers: [MarketingController],
	providers: [ReferralCouponService, PointsService, RewardedAdService],
	exports: [ReferralCouponService, PointsService, RewardedAdService],
})
export class MarketingModule {}
