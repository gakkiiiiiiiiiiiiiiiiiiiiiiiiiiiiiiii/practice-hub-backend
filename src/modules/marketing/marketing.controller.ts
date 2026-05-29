import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { ReferralCouponService } from './referral-coupon.service';
import { UserCouponStatus } from '../../database/entities/user-coupon.entity';

@ApiTags('营销')
@Controller('app/marketing')
export class MarketingController {
	constructor(private readonly referralCouponService: ReferralCouponService) {}

	@Get('referral/config')
	@ApiOperation({ summary: '拉新优惠券公开配置' })
	async getReferralConfig() {
		const config = await this.referralCouponService.getConfig();
		return CommonResponseDto.success({
			enabled: config.enabled,
			inviteCountPerReward: config.invite_count_per_reward,
			couponAmount: config.coupon_amount,
			couponMinAmount: config.coupon_min_amount,
			maxCouponsPerUser: config.max_coupons_per_user,
		});
	}

	@Get('referral/stats')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '拉新统计' })
	async getReferralStats(@CurrentUser() user: any) {
		const result = await this.referralCouponService.getReferralStats(user.userId);
		return CommonResponseDto.success(result);
	}

	@Get('coupons')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '我的优惠券' })
	async getCoupons(@CurrentUser() user: any, @Query('status') status?: string) {
		const parsedStatus =
			status && Object.values(UserCouponStatus).includes(status as UserCouponStatus)
				? (status as UserCouponStatus)
				: undefined;
		const result = await this.referralCouponService.getUserCoupons(user.userId, parsedStatus);
		return CommonResponseDto.success(result);
	}
}
