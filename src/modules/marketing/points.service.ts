import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserPointsLog, UserPointsLogType } from '../../database/entities/user-points-log.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';
import { normalizeThresholdYuan } from '../../common/utils/price.util';

export type PointsConfig = {
	enabled: boolean;
	checkin_reward: number;
	exchange_points: number;
	exchange_coupon_amount: number;
	exchange_coupon_min_amount: number;
	coupon_valid_days: number | null;
};

const DEFAULT_POINTS_CONFIG: PointsConfig = {
	enabled: true,
	checkin_reward: 50,
	exchange_points: 500,
	exchange_coupon_amount: 5,
	exchange_coupon_min_amount: 0,
	coupon_valid_days: 365,
};

@Injectable()
export class PointsService {
	constructor(
		@InjectRepository(SystemConfig)
		private systemConfigRepository: Repository<SystemConfig>,
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
		@InjectRepository(UserPointsLog)
		private userPointsLogRepository: Repository<UserPointsLog>,
		@InjectRepository(UserCoupon)
		private userCouponRepository: Repository<UserCoupon>,
		private dataSource: DataSource,
	) {}

	async getConfig(): Promise<PointsConfig> {
		const config = await this.systemConfigRepository.findOne({
			where: { configKey: 'points_config' },
		});
		if (!config?.configValue) {
			return { ...DEFAULT_POINTS_CONFIG };
		}
		try {
			const parsed = JSON.parse(config.configValue) as Partial<PointsConfig>;
			return {
				enabled: parsed.enabled !== false,
				checkin_reward: Math.max(0, Number(parsed.checkin_reward) || 50),
				exchange_points: Math.max(1, Number(parsed.exchange_points) || 500),
				exchange_coupon_amount: Math.max(0.01, Number(parsed.exchange_coupon_amount) || 5),
				exchange_coupon_min_amount: normalizeThresholdYuan(parsed.exchange_coupon_min_amount),
				coupon_valid_days:
					parsed.coupon_valid_days === null || parsed.coupon_valid_days === undefined
						? 365
						: Math.max(1, Number(parsed.coupon_valid_days) || 365),
			};
		} catch {
			return { ...DEFAULT_POINTS_CONFIG };
		}
	}

	async setConfig(input: Partial<PointsConfig>) {
		const current = await this.getConfig();
		const next: PointsConfig = {
			enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
			checkin_reward: Math.max(0, Number(input.checkin_reward ?? current.checkin_reward) || 0),
			exchange_points: Math.max(1, Number(input.exchange_points ?? current.exchange_points) || 500),
			exchange_coupon_amount: Math.max(
				0.01,
				Number(input.exchange_coupon_amount ?? current.exchange_coupon_amount) || 5,
			),
			exchange_coupon_min_amount: normalizeThresholdYuan(
				input.exchange_coupon_min_amount ?? current.exchange_coupon_min_amount,
			),
			coupon_valid_days:
				input.coupon_valid_days === null
					? null
					: Math.max(1, Number(input.coupon_valid_days ?? current.coupon_valid_days) || 365),
		};

		let config = await this.systemConfigRepository.findOne({ where: { configKey: 'points_config' } });
		if (!config) {
			config = this.systemConfigRepository.create({
				configKey: 'points_config',
				configValue: JSON.stringify(next),
				description: '积分系统配置',
			});
		} else {
			config.configValue = JSON.stringify(next);
			config.updateTime = new Date();
		}
		await this.systemConfigRepository.save(config);
		return next;
	}

	async getBalance(userId: number) {
		const user = await this.appUserRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new NotFoundException('用户不存在');
		}
		return Math.max(0, Number(user.points_balance || 0));
	}

	async getLogs(userId: number, page = 1, pageSize = 20) {
		const safePage = Math.max(1, Number(page) || 1);
		const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
		const skip = (safePage - 1) * safePageSize;

		const [logs, total] = await this.userPointsLogRepository.findAndCount({
			where: { userId },
			order: { createTime: 'DESC' },
			skip,
			take: safePageSize,
		});

		return {
			list: logs.map((log) => ({
				id: log.id,
				changeAmount: log.changeAmount,
				balanceAfter: log.balanceAfter,
				type: log.type,
				remark: log.remark,
				createTime: log.createTime,
			})),
			total,
			page: safePage,
			pageSize: safePageSize,
		};
	}

	async rewardCheckin(userId: number) {
		const config = await this.getConfig();
		if (!config.enabled || config.checkin_reward <= 0) {
			const balance = await this.getBalance(userId);
			return { pointsEarned: 0, balance };
		}

		return this.changePoints(userId, config.checkin_reward, UserPointsLogType.CHECKIN, '刷题打卡奖励');
	}

	async exchangeCoupon(userId: number) {
		const config = await this.getConfig();
		if (!config.enabled) {
			throw new BadRequestException('积分系统暂未开放');
		}

		const requiredPoints = config.exchange_points;
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			const user = await queryRunner.manager.findOne(AppUser, {
				where: { id: userId },
				lock: { mode: 'pessimistic_write' },
			});
			if (!user) {
				throw new NotFoundException('用户不存在');
			}

			const currentBalance = Math.max(0, Number(user.points_balance || 0));
			if (currentBalance < requiredPoints) {
				throw new BadRequestException(`积分不足，还需 ${requiredPoints - currentBalance} 积分`);
			}

			const nextBalance = currentBalance - requiredPoints;
			user.points_balance = nextBalance;
			await queryRunner.manager.save(user);

			let expireTime: Date | null = null;
			if (config.coupon_valid_days) {
				expireTime = new Date();
				expireTime.setDate(expireTime.getDate() + config.coupon_valid_days);
			}

			const coupon = await queryRunner.manager.save(UserCoupon, {
				user_id: userId,
				amount: config.exchange_coupon_amount,
				min_amount: config.exchange_coupon_min_amount,
				status: UserCouponStatus.UNUSED,
				source: 'points',
				expire_time: expireTime,
			});

			await queryRunner.manager.save(UserPointsLog, {
				userId,
				changeAmount: -requiredPoints,
				balanceAfter: nextBalance,
				type: UserPointsLogType.EXCHANGE,
				remark: `兑换${config.exchange_coupon_amount}元优惠券`,
			});

			await queryRunner.commitTransaction();

			return {
				couponId: coupon.id,
				pointsUsed: requiredPoints,
				balance: nextBalance,
				couponAmount: config.exchange_coupon_amount,
				couponMinAmount: config.exchange_coupon_min_amount,
			};
		} catch (error) {
			await queryRunner.rollbackTransaction();
			throw error;
		} finally {
			await queryRunner.release();
		}
	}

	private async changePoints(userId: number, amount: number, type: UserPointsLogType, remark: string) {
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			const user = await queryRunner.manager.findOne(AppUser, {
				where: { id: userId },
				lock: { mode: 'pessimistic_write' },
			});
			if (!user) {
				throw new NotFoundException('用户不存在');
			}

			const currentBalance = Math.max(0, Number(user.points_balance || 0));
			const nextBalance = currentBalance + amount;
			user.points_balance = nextBalance;
			await queryRunner.manager.save(user);

			await queryRunner.manager.save(UserPointsLog, {
				userId,
				changeAmount: amount,
				balanceAfter: nextBalance,
				type,
				remark,
			});

			await queryRunner.commitTransaction();
			return { pointsEarned: amount, balance: nextBalance };
		} catch (error) {
			await queryRunner.rollbackTransaction();
			throw error;
		} finally {
			await queryRunner.release();
		}
	}
}
