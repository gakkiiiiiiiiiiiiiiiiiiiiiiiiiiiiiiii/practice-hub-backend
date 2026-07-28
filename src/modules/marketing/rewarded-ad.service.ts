import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';

const TARGET_WATCH_COUNT = 5;
const REWARD_COUPON_AMOUNT = 5;
const REWARD_COUPON_VALID_DAYS = 365;
const DAILY_REWARD_LIMIT = 10;
const CHINA_TIME_ZONE = 'Asia/Shanghai';

@Injectable()
export class RewardedAdService {
	constructor(
		@InjectRepository(AppUser)
		private readonly appUserRepository: Repository<AppUser>,
		private readonly dataSource: DataSource,
	) {}

	async getStatus(userId: number) {
		const user = await this.appUserRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new NotFoundException('用户不存在');
		}
		const dailyClaimedCount = this.getDailyClaimedCount(user);
		return this.buildStatus(user, dailyClaimedCount);
	}

	async completeView(userId: number) {
		return this.dataSource.transaction(async (manager) => {
			const appUserRepository = manager.getRepository(AppUser);
			const couponRepository = manager.getRepository(UserCoupon);
			const user = await appUserRepository
				.createQueryBuilder('user')
				.setLock('pessimistic_write')
				.where('user.id = :userId', { userId })
				.getOne();

			if (!user) {
				throw new NotFoundException('用户不存在');
			}

			const activityDate = this.getChinaDateKey();
			if (String(user.rewarded_ad_activity_date || '') !== activityDate) {
				user.rewarded_ad_activity_date = activityDate;
				user.rewarded_ad_daily_coupon_count = 0;
			}
			const dailyClaimedCount = this.getDailyClaimedCount(user, activityDate);
			if (dailyClaimedCount >= DAILY_REWARD_LIMIT) {
				return {
					...this.buildStatus(user, dailyClaimedCount),
					couponIssuedNow: false,
				};
			}

			// 兼容旧版“一次性领取”数据：已发券用户从新一轮 0/5 开始。
			if (user.rewarded_ad_coupon_issued) {
				user.rewarded_ad_watch_count = 0;
				user.rewarded_ad_coupon_issued = false;
			}

			user.rewarded_ad_watch_count = this.normalizeWatchCount(user.rewarded_ad_watch_count) + 1;

			let couponIssuedNow = false;
			if (user.rewarded_ad_watch_count >= TARGET_WATCH_COUNT) {
				const expireTime = new Date();
				expireTime.setDate(expireTime.getDate() + REWARD_COUPON_VALID_DAYS);
				await couponRepository.save(
					couponRepository.create({
						user_id: userId,
						amount: REWARD_COUPON_AMOUNT,
						min_amount: 0,
						status: UserCouponStatus.UNUSED,
						source: 'rewarded_ad',
						expire_time: expireTime,
					}),
				);
				user.rewarded_ad_watch_count = 0;
				user.rewarded_ad_coupon_issued = false;
				user.rewarded_ad_daily_coupon_count = dailyClaimedCount + 1;
				couponIssuedNow = true;
			}

			await appUserRepository.save(user);
			return {
				...this.buildStatus(user, this.getDailyClaimedCount(user, activityDate)),
				couponIssuedNow,
			};
		});
	}

	private buildStatus(user: AppUser, dailyClaimedCount: number) {
		const watchedCount = user.rewarded_ad_coupon_issued
			? 0
			: this.normalizeWatchCount(user.rewarded_ad_watch_count);
		const normalizedDailyClaimedCount = Math.min(
			DAILY_REWARD_LIMIT,
			Math.max(0, Number(dailyClaimedCount) || 0),
		);
		const dailyLimitReached = normalizedDailyClaimedCount >= DAILY_REWARD_LIMIT;
		return {
			watchedCount,
			targetCount: TARGET_WATCH_COUNT,
			remainingCount: Math.max(0, TARGET_WATCH_COUNT - watchedCount),
			rewardAmount: REWARD_COUPON_AMOUNT,
			dailyClaimedCount: normalizedDailyClaimedCount,
			dailyClaimLimit: DAILY_REWARD_LIMIT,
			dailyRemainingCount: Math.max(0, DAILY_REWARD_LIMIT - normalizedDailyClaimedCount),
			dailyLimitReached,
			// 保留旧字段，供未升级的小程序在达到当日上限后隐藏入口。
			rewarded: dailyLimitReached,
		};
	}

	private normalizeWatchCount(value: number) {
		const count = Math.max(0, Number(value) || 0);
		return count >= TARGET_WATCH_COUNT ? count % TARGET_WATCH_COUNT : count;
	}

	private getDailyClaimedCount(user: AppUser, activityDate = this.getChinaDateKey()) {
		if (String(user.rewarded_ad_activity_date || '') !== activityDate) {
			return 0;
		}
		return Math.min(
			DAILY_REWARD_LIMIT,
			Math.max(0, Number(user.rewarded_ad_daily_coupon_count) || 0),
		);
	}

	private getChinaDateKey(now = new Date()) {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: CHINA_TIME_ZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).formatToParts(now);
		const year = Number(parts.find((part) => part.type === 'year')?.value);
		const month = Number(parts.find((part) => part.type === 'month')?.value);
		const day = Number(parts.find((part) => part.type === 'day')?.value);
		return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}
}
