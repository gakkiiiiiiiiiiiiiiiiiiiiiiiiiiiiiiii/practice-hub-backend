import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { UserReferral } from '../../database/entities/user-referral.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';
import { AppUser } from '../../database/entities/app-user.entity';

export type ReferralCouponConfig = {
	enabled: boolean;
	invite_count_per_reward: number;
	coupon_amount: number;
	max_coupons_per_user: number;
	coupon_valid_days: number | null;
};

const DEFAULT_REFERRAL_CONFIG: ReferralCouponConfig = {
	enabled: true,
	invite_count_per_reward: 3,
	coupon_amount: 5,
	max_coupons_per_user: 10,
	coupon_valid_days: 365,
};

@Injectable()
export class ReferralCouponService {
	constructor(
		@InjectRepository(SystemConfig)
		private systemConfigRepository: Repository<SystemConfig>,
		@InjectRepository(UserReferral)
		private userReferralRepository: Repository<UserReferral>,
		@InjectRepository(UserCoupon)
		private userCouponRepository: Repository<UserCoupon>,
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
	) {}

	async getConfig(): Promise<ReferralCouponConfig> {
		const config = await this.systemConfigRepository.findOne({
			where: { configKey: 'referral_coupon_config' },
		});
		if (!config?.configValue) {
			return { ...DEFAULT_REFERRAL_CONFIG };
		}
		try {
			const parsed = JSON.parse(config.configValue) as Partial<ReferralCouponConfig>;
			return {
				enabled: parsed.enabled !== false,
				invite_count_per_reward: Math.max(1, Number(parsed.invite_count_per_reward) || 3),
				coupon_amount: Math.max(0.01, Number(parsed.coupon_amount) || 5),
				max_coupons_per_user: Math.max(1, Number(parsed.max_coupons_per_user) || 10),
				coupon_valid_days:
					parsed.coupon_valid_days === null || parsed.coupon_valid_days === undefined
						? 365
						: Math.max(1, Number(parsed.coupon_valid_days) || 365),
			};
		} catch {
			return { ...DEFAULT_REFERRAL_CONFIG };
		}
	}

	async setConfig(input: Partial<ReferralCouponConfig>) {
		const current = await this.getConfig();
		const next: ReferralCouponConfig = {
			enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
			invite_count_per_reward: Math.max(1, Number(input.invite_count_per_reward ?? current.invite_count_per_reward) || 3),
			coupon_amount: Math.max(0.01, Number(input.coupon_amount ?? current.coupon_amount) || 5),
			max_coupons_per_user: Math.max(1, Number(input.max_coupons_per_user ?? current.max_coupons_per_user) || 10),
			coupon_valid_days:
				input.coupon_valid_days === null
					? null
					: Math.max(1, Number(input.coupon_valid_days ?? current.coupon_valid_days) || 365),
		};

		let config = await this.systemConfigRepository.findOne({ where: { configKey: 'referral_coupon_config' } });
		if (!config) {
			config = this.systemConfigRepository.create({
				configKey: 'referral_coupon_config',
				configValue: JSON.stringify(next),
				description: '拉新优惠券配置',
			});
		} else {
			config.configValue = JSON.stringify(next);
			config.updateTime = new Date();
		}
		await this.systemConfigRepository.save(config);
		return next;
	}

	async bindReferralOnRegister(inviteeUserId: number, referralUserId?: number) {
		const config = await this.getConfig();
		if (!config.enabled || !referralUserId || referralUserId === inviteeUserId) {
			return null;
		}

		const inviter = await this.appUserRepository.findOne({ where: { id: referralUserId } });
		if (!inviter) {
			return null;
		}

		const existing = await this.userReferralRepository.findOne({ where: { invitee_user_id: inviteeUserId } });
		if (existing) {
			return existing;
		}

		const referral = await this.userReferralRepository.save({
			inviter_user_id: referralUserId,
			invitee_user_id: inviteeUserId,
		});

		await this.tryIssueReferralCoupons(referralUserId);
		return referral;
	}

	private async tryIssueReferralCoupons(inviterUserId: number) {
		const config = await this.getConfig();
		if (!config.enabled) return;

		const referralCount = await this.userReferralRepository.count({ where: { inviter_user_id: inviterUserId } });
		const issuedCount = await this.userCouponRepository.count({
			where: { user_id: inviterUserId, source: 'referral' },
		});

		const expectedCoupons = Math.floor(referralCount / config.invite_count_per_reward);
		const toIssue = Math.min(expectedCoupons - issuedCount, config.max_coupons_per_user - issuedCount);
		if (toIssue <= 0) return;

		for (let i = 0; i < toIssue; i++) {
			let expireTime: Date | null = null;
			if (config.coupon_valid_days) {
				expireTime = new Date();
				expireTime.setDate(expireTime.getDate() + config.coupon_valid_days);
			}
			await this.userCouponRepository.save({
				user_id: inviterUserId,
				amount: config.coupon_amount,
				min_amount: 0,
				status: UserCouponStatus.UNUSED,
				source: 'referral',
				expire_time: expireTime,
			});
		}
	}

	async getReferralStats(userId: number) {
		const config = await this.getConfig();
		const referralCount = await this.userReferralRepository.count({ where: { inviter_user_id: userId } });
		const couponCount = await this.userCouponRepository.count({
			where: { user_id: userId, source: 'referral', status: UserCouponStatus.UNUSED },
		});
		const totalCoupons = await this.userCouponRepository.count({
			where: { user_id: userId, source: 'referral' },
		});
		const progressInCycle = referralCount % config.invite_count_per_reward;
		const remainingToNext =
			config.max_coupons_per_user <= totalCoupons
				? 0
				: config.invite_count_per_reward - (progressInCycle === 0 && referralCount > 0 ? config.invite_count_per_reward : progressInCycle);

		return {
			config,
			referralCount,
			unusedCouponCount: couponCount,
			totalCouponCount: totalCoupons,
			progressInCycle: progressInCycle === 0 && referralCount > 0 ? config.invite_count_per_reward : progressInCycle,
			remainingToNext: remainingToNext === config.invite_count_per_reward ? config.invite_count_per_reward : remainingToNext,
			canEarnMore: totalCoupons < config.max_coupons_per_user,
		};
	}

	async getUserCoupons(userId: number, status?: UserCouponStatus) {
		const where: Record<string, unknown> = { user_id: userId };
		if (status) {
			where.status = status;
		}
		const coupons = await this.userCouponRepository.find({
			where,
			order: { create_time: 'DESC' },
		});
		const now = new Date();
		return coupons.map((coupon) => {
			const expired = coupon.status === UserCouponStatus.UNUSED && coupon.expire_time && coupon.expire_time <= now;
			return {
				id: coupon.id,
				amount: Number(coupon.amount),
				minAmount: Number(coupon.min_amount),
				status: expired ? UserCouponStatus.EXPIRED : coupon.status,
				source: coupon.source,
				expireTime: coupon.expire_time,
				createTime: coupon.create_time,
				label: Number(coupon.min_amount) <= 0 ? `${Number(coupon.amount)}元无门槛` : `满${Number(coupon.min_amount)}减${Number(coupon.amount)}`,
			};
		});
	}

	async validateCouponForOrder(userId: number, couponId: number, orderAmount: number) {
		const coupon = await this.userCouponRepository.findOne({ where: { id: couponId, user_id: userId } });
		if (!coupon) {
			throw new NotFoundException('优惠券不存在');
		}
		if (coupon.status !== UserCouponStatus.UNUSED) {
			throw new BadRequestException('优惠券不可用');
		}
		if (coupon.expire_time && coupon.expire_time <= new Date()) {
			throw new BadRequestException('优惠券已过期');
		}
		const minAmount = Number(coupon.min_amount) || 0;
		if (orderAmount < minAmount) {
			throw new BadRequestException(`订单金额需满${minAmount}元才可使用该优惠券`);
		}
		const discount = Math.min(orderAmount, Number(coupon.amount) || 0);
		return { coupon, discount };
	}

	async markCouponUsed(couponId: number, orderId: number) {
		await this.userCouponRepository.update(couponId, {
			status: UserCouponStatus.USED,
			used_order_id: orderId,
		});
	}

	async releaseCoupon(couponId: number) {
		await this.userCouponRepository.update(couponId, {
			status: UserCouponStatus.UNUSED,
			used_order_id: null,
		});
	}
}
