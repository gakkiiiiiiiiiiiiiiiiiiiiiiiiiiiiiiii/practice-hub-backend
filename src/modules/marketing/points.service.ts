import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserPointsLog, UserPointsLogType } from '../../database/entities/user-points-log.entity';
import { UserCoupon, UserCouponStatus } from '../../database/entities/user-coupon.entity';
import { normalizeThresholdYuan } from '../../common/utils/price.util';

export type PointsExchangeItem = {
	id: string;
	name: string;
	points: number;
	coupon_amount: number;
	coupon_min_amount: number;
	enabled: boolean;
	sort: number;
};

export type PointsConfig = {
	enabled: boolean;
	checkin_reward: number;
	exchange_points: number;
	exchange_coupon_amount: number;
	exchange_coupon_min_amount: number;
	coupon_valid_days: number | null;
	exchange_items: PointsExchangeItem[];
};

const DEFAULT_EXCHANGE_ITEM: Omit<PointsExchangeItem, 'id'> = {
	name: '',
	points: 500,
	coupon_amount: 5,
	coupon_min_amount: 0,
	enabled: true,
	sort: 0,
};

const DEFAULT_POINTS_CONFIG: PointsConfig = {
	enabled: true,
	checkin_reward: 50,
	exchange_points: 500,
	exchange_coupon_amount: 5,
	exchange_coupon_min_amount: 0,
	coupon_valid_days: 365,
	exchange_items: [],
};

const createExchangeItemId = () =>
	`ex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeExchangeItem = (item: Partial<PointsExchangeItem>, index: number): PointsExchangeItem => ({
	id: String(item.id || createExchangeItemId()),
	name: String(item.name || '').trim(),
	points: Math.max(1, Number(item.points) || 500),
	coupon_amount: Math.max(0.01, Number(item.coupon_amount) || 5),
	coupon_min_amount: normalizeThresholdYuan(item.coupon_min_amount),
	enabled: item.enabled !== false,
	sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : index,
});

const buildLegacyExchangeFields = (items: PointsExchangeItem[]) => {
	const first = items.find((item) => item.enabled) || items[0];
	return {
		exchange_points: first?.points ?? DEFAULT_EXCHANGE_ITEM.points,
		exchange_coupon_amount: first?.coupon_amount ?? DEFAULT_EXCHANGE_ITEM.coupon_amount,
		exchange_coupon_min_amount: first?.coupon_min_amount ?? DEFAULT_EXCHANGE_ITEM.coupon_min_amount,
	};
};

const normalizeExchangeItems = (parsed: Partial<PointsConfig>): PointsExchangeItem[] => {
	if (Array.isArray(parsed.exchange_items) && parsed.exchange_items.length > 0) {
		return parsed.exchange_items
			.map((item, index) => normalizeExchangeItem(item, index))
			.sort((a, b) => a.sort - b.sort || a.points - b.points);
	}

	return [
		normalizeExchangeItem(
			{
				points: Number(parsed.exchange_points) || DEFAULT_EXCHANGE_ITEM.points,
				coupon_amount: Number(parsed.exchange_coupon_amount) || DEFAULT_EXCHANGE_ITEM.coupon_amount,
				coupon_min_amount: normalizeThresholdYuan(parsed.exchange_coupon_min_amount),
				enabled: true,
				sort: 0,
			},
			0,
		),
	];
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
			const exchangeItems = [normalizeExchangeItem(DEFAULT_EXCHANGE_ITEM, 0)];
			return {
				...DEFAULT_POINTS_CONFIG,
				exchange_items: exchangeItems,
				...buildLegacyExchangeFields(exchangeItems),
			};
		}
		try {
			const parsed = JSON.parse(config.configValue) as Partial<PointsConfig>;
			const exchange_items = normalizeExchangeItems(parsed);
			const legacy = buildLegacyExchangeFields(exchange_items);
			return {
				enabled: parsed.enabled !== false,
				checkin_reward: Math.max(0, Number(parsed.checkin_reward) || 50),
				coupon_valid_days:
					parsed.coupon_valid_days === null || parsed.coupon_valid_days === undefined
						? 365
						: Math.max(1, Number(parsed.coupon_valid_days) || 365),
				exchange_items,
				...legacy,
			};
		} catch {
			const exchangeItems = [normalizeExchangeItem(DEFAULT_EXCHANGE_ITEM, 0)];
			return {
				...DEFAULT_POINTS_CONFIG,
				exchange_items: exchangeItems,
				...buildLegacyExchangeFields(exchangeItems),
			};
		}
	}

	async setConfig(input: Partial<PointsConfig>) {
		const current = await this.getConfig();
		const exchange_items =
			Array.isArray(input.exchange_items) && input.exchange_items.length > 0
				? input.exchange_items.map((item, index) => normalizeExchangeItem(item, index))
				: current.exchange_items;
		const legacy = buildLegacyExchangeFields(exchange_items);
		const next: PointsConfig = {
			enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
			checkin_reward: Math.max(0, Number(input.checkin_reward ?? current.checkin_reward) || 0),
			coupon_valid_days:
				input.coupon_valid_days === null
					? null
					: Math.max(1, Number(input.coupon_valid_days ?? current.coupon_valid_days) || 365),
			exchange_items,
			...legacy,
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

	getEnabledExchangeItems(config: PointsConfig) {
		return config.exchange_items
			.filter((item) => item.enabled)
			.sort((a, b) => a.sort - b.sort || a.points - b.points);
	}

	resolveExchangeItem(config: PointsConfig, itemId?: string) {
		const enabledItems = this.getEnabledExchangeItems(config);
		if (enabledItems.length === 0) {
			throw new BadRequestException('暂无可兑换优惠券');
		}
		if (!itemId) {
			return enabledItems[0];
		}
		const item = enabledItems.find((entry) => entry.id === itemId);
		if (!item) {
			throw new BadRequestException('兑换项不存在或已下架');
		}
		return item;
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

	async exchangeCoupon(userId: number, itemId?: string) {
		const config = await this.getConfig();
		if (!config.enabled) {
			throw new BadRequestException('积分系统暂未开放');
		}

		const exchangeItem = this.resolveExchangeItem(config, itemId);
		const requiredPoints = exchangeItem.points;
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
				amount: exchangeItem.coupon_amount,
				min_amount: exchangeItem.coupon_min_amount,
				status: UserCouponStatus.UNUSED,
				source: 'points',
				expire_time: expireTime,
			});

			const remarkLabel = exchangeItem.name || `${exchangeItem.coupon_amount}元优惠券`;
			await queryRunner.manager.save(UserPointsLog, {
				userId,
				changeAmount: -requiredPoints,
				balanceAfter: nextBalance,
				type: UserPointsLogType.EXCHANGE,
				remark: `兑换${remarkLabel}`,
			});

			await queryRunner.commitTransaction();

			return {
				couponId: coupon.id,
				itemId: exchangeItem.id,
				pointsUsed: requiredPoints,
				balance: nextBalance,
				couponAmount: exchangeItem.coupon_amount,
				couponMinAmount: exchangeItem.coupon_min_amount,
				itemName: exchangeItem.name,
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
