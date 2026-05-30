import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { UserReferral } from '../../database/entities/user-referral.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { assertIntegerYuanPrice, normalizeThresholdYuan, formatYuanDisplay } from '../../common/utils/price.util';
import { IssueCouponDto } from './dto/issue-coupon.dto';
import { GetAdminCouponListDto } from './dto/get-admin-coupon-list.dto';

export type ReferralCouponConfig = {
	enabled: boolean;
	invite_count_per_reward: number;
	coupon_amount: number;
	coupon_min_amount: number;
	max_coupons_per_user: number;
	coupon_valid_days: number | null;
};

const DEFAULT_REFERRAL_CONFIG: ReferralCouponConfig = {
	enabled: true,
	invite_count_per_reward: 3,
	coupon_amount: 5,
	coupon_min_amount: 0,
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
				coupon_min_amount: normalizeThresholdYuan(parsed.coupon_min_amount),
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
			coupon_min_amount: normalizeThresholdYuan(input.coupon_min_amount ?? current.coupon_min_amount),
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

	/**
	 * 登录/注册时尝试绑定拉新关系（允许首次登录未绑定的用户在7天内补绑）
	 */
	async bindReferralOnAuth(inviteeUserId: number, referralUserId?: number) {
		if (!referralUserId) {
			return null;
		}

		const existing = await this.userReferralRepository.findOne({ where: { invitee_user_id: inviteeUserId } });
		if (existing) {
			return existing;
		}

		const invitee = await this.appUserRepository.findOne({ where: { id: inviteeUserId } });
		if (!invitee) {
			return null;
		}

		const maxBindWindowMs = 7 * 24 * 60 * 60 * 1000;
		const accountAgeMs = Date.now() - new Date(invitee.create_time).getTime();
		if (accountAgeMs > maxBindWindowMs) {
			return null;
		}

		return this.bindReferralOnRegister(inviteeUserId, referralUserId);
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
				min_amount: config.coupon_min_amount,
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
				label: this.formatCouponLabel(Number(coupon.amount), Number(coupon.min_amount)),
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
			throw new BadRequestException(`订单金额需满${formatYuanDisplay(minAmount)}元才可使用该优惠券`);
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

	private formatCouponLabel(amount: number, minAmount: number) {
		const amountText = formatYuanDisplay(amount);
		return minAmount <= 0 ? `无门槛${amountText}元优惠券` : `${amountText}元优惠券`;
	}

	private resolveCouponStatus(coupon: UserCoupon) {
		const now = new Date();
		const expired =
			coupon.status === UserCouponStatus.UNUSED && coupon.expire_time && coupon.expire_time <= now;
		return expired ? UserCouponStatus.EXPIRED : coupon.status;
	}

	async issueCouponsByAdmin(dto: IssueCouponDto) {
		const user = await this.appUserRepository.findOne({ where: { id: dto.user_id } });
		if (!user) {
			throw new NotFoundException('用户不存在');
		}

		assertIntegerYuanPrice(dto.amount, '优惠券面额');
		const minAmount = normalizeThresholdYuan(dto.min_amount);

		const count = Math.min(50, Math.max(1, Number(dto.count ?? 1)));
		let expireTime: Date | null = null;
		if (dto.valid_days && dto.valid_days > 0) {
			expireTime = new Date();
			expireTime.setDate(expireTime.getDate() + dto.valid_days);
		}

		const coupons = Array.from({ length: count }, () =>
			this.userCouponRepository.create({
				user_id: dto.user_id,
				amount: dto.amount,
				min_amount: minAmount,
				status: UserCouponStatus.UNUSED,
				source: 'admin',
				expire_time: expireTime,
			}),
		);
		const saved = await this.userCouponRepository.save(coupons);

		return {
			userId: user.id,
			nickname: user.nickname || '未设置',
			issuedCount: saved.length,
			coupons: saved.map((coupon) => ({
				id: coupon.id,
				amount: Number(coupon.amount),
				minAmount: Number(coupon.min_amount),
				label: this.formatCouponLabel(Number(coupon.amount), Number(coupon.min_amount)),
				expireTime: coupon.expire_time,
			})),
		};
	}

	async getAdminCouponList(dto: GetAdminCouponListDto) {
		const page = dto.page ?? 1;
		const pageSize = dto.pageSize ?? 10;
		const skip = (page - 1) * pageSize;

		const queryBuilder = this.userCouponRepository.createQueryBuilder('coupon').orderBy('coupon.create_time', 'DESC');

		if (dto.user_id) {
			queryBuilder.andWhere('coupon.user_id = :userId', { userId: dto.user_id });
		}

		if (dto.source) {
			queryBuilder.andWhere('coupon.source = :source', { source: dto.source });
		}

		if (dto.status === UserCouponStatus.USED) {
			queryBuilder.andWhere('coupon.status = :status', { status: UserCouponStatus.USED });
		} else if (dto.status === UserCouponStatus.EXPIRED) {
			queryBuilder.andWhere('coupon.status = :unused', { unused: UserCouponStatus.UNUSED });
			queryBuilder.andWhere('coupon.expire_time IS NOT NULL');
			queryBuilder.andWhere('coupon.expire_time <= :now', { now: new Date() });
		} else if (dto.status === UserCouponStatus.UNUSED) {
			queryBuilder.andWhere('coupon.status = :status', { status: UserCouponStatus.UNUSED });
			queryBuilder.andWhere('(coupon.expire_time IS NULL OR coupon.expire_time > :now)', { now: new Date() });
		}

		if (dto.keyword) {
			const users = await this.appUserRepository
				.createQueryBuilder('user')
				.select(['user.id'])
				.where('(user.nickname LIKE :keyword OR user.openid LIKE :keyword)', { keyword: `%${dto.keyword}%` })
				.getMany();
			const userIds = users.map((item) => item.id);
			if (userIds.length === 0) {
				return { list: [], total: 0, page, pageSize };
			}
			queryBuilder.andWhere('coupon.user_id IN (:...userIds)', { userIds });
		}

		const total = await queryBuilder.getCount();
		const coupons = await queryBuilder.skip(skip).take(pageSize).getMany();
		const userIds = [...new Set(coupons.map((coupon) => coupon.user_id))];
		const users =
			userIds.length > 0
				? await this.appUserRepository.find({
						where: { id: In(userIds) },
					})
				: [];
		const userMap = new Map(users.map((user) => [user.id, user]));

		const list = coupons.map((coupon) => {
			const user = userMap.get(coupon.user_id);
			const amount = Number(coupon.amount);
			const minAmount = Number(coupon.min_amount);
			const status = this.resolveCouponStatus(coupon);
			return {
				id: coupon.id,
				userId: coupon.user_id,
				user: user
					? {
							id: user.id,
							nickname: user.nickname || '未设置',
							openId: user.openid,
							avatar: user.avatar,
						}
					: null,
				amount,
				minAmount,
				label: this.formatCouponLabel(amount, minAmount),
				status,
				source: coupon.source,
				sourceLabel: coupon.source === 'admin' ? '后台发放' : coupon.source === 'referral' ? '拉新奖励' : coupon.source,
				expireTime: coupon.expire_time,
				createTime: coupon.create_time,
				usedOrderId: coupon.used_order_id,
			};
		});

		return { list, total, page, pageSize };
	}
}
