import { Controller, Get, Post, Query, UseGuards, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { ReferralCouponService } from './referral-coupon.service';
import { PointsService } from './points.service';
import { UserCouponStatus } from '../../database/entities/user-coupon.entity';

@ApiTags('营销')
@Controller('app/marketing')
export class MarketingController {
	constructor(
		private readonly referralCouponService: ReferralCouponService,
		private readonly pointsService: PointsService,
	) {}

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

	@Get('points/config')
	@ApiOperation({ summary: '积分商城公开配置' })
	async getPointsConfig() {
		const config = await this.pointsService.getConfig();
		const exchangeItems = this.pointsService.getEnabledExchangeItems(config).map((item) => ({
			id: item.id,
			name: item.name,
			points: item.points,
			couponAmount: item.coupon_amount,
			couponMinAmount: item.coupon_min_amount,
		}));
		const firstItem = exchangeItems[0];
		return CommonResponseDto.success({
			enabled: config.enabled,
			checkinReward: config.checkin_reward,
			exchangeItems,
			exchangePoints: firstItem?.points ?? config.exchange_points,
			exchangeCouponAmount: firstItem?.couponAmount ?? config.exchange_coupon_amount,
			exchangeCouponMinAmount: firstItem?.couponMinAmount ?? config.exchange_coupon_min_amount,
		});
	}

	@Get('points/balance')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '我的积分余额' })
	async getPointsBalance(@CurrentUser() user: any) {
		const balance = await this.pointsService.getBalance(user.userId);
		return CommonResponseDto.success({ balance });
	}

	@Get('points/logs')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '积分流水' })
	async getPointsLogs(
		@CurrentUser() user: any,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
	) {
		const result = await this.pointsService.getLogs(user.userId, Number(page) || 1, Number(pageSize) || 20);
		return CommonResponseDto.success(result);
	}

	@Post('points/exchange')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: '积分兑换优惠券' })
	async exchangePointsCoupon(@CurrentUser() user: any, @Body() body: { itemId?: string }) {
		const result = await this.pointsService.exchangeCoupon(user.userId, body?.itemId);
		return CommonResponseDto.success(result);
	}
}
