import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ReferralCouponService } from './referral-coupon.service';
import { MarketingController } from './marketing.controller';

@Module({
	imports: [DatabaseModule],
	controllers: [MarketingController],
	providers: [ReferralCouponService],
	exports: [ReferralCouponService],
})
export class MarketingModule {}
