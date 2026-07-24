import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';

const TARGET_WATCH_COUNT = 5;
const REWARD_COUPON_AMOUNT = 5;
const REWARD_COUPON_VALID_DAYS = 365;

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
		return this.buildStatus(user);
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
			if (user.rewarded_ad_coupon_issued) {
				return this.buildStatus(user);
			}

			user.rewarded_ad_watch_count = Math.min(
				TARGET_WATCH_COUNT,
				Math.max(0, Number(user.rewarded_ad_watch_count) || 0) + 1,
			);

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
				user.rewarded_ad_coupon_issued = true;
				couponIssuedNow = true;
			}

			await appUserRepository.save(user);
			return {
				...this.buildStatus(user),
				couponIssuedNow,
			};
		});
	}

	private buildStatus(user: AppUser) {
		const watchedCount = Math.min(
			TARGET_WATCH_COUNT,
			Math.max(0, Number(user.rewarded_ad_watch_count) || 0),
		);
		return {
			watchedCount,
			targetCount: TARGET_WATCH_COUNT,
			remainingCount: Math.max(0, TARGET_WATCH_COUNT - watchedCount),
			rewardAmount: REWARD_COUPON_AMOUNT,
			rewarded: Boolean(user.rewarded_ad_coupon_issued),
		};
	}
}
