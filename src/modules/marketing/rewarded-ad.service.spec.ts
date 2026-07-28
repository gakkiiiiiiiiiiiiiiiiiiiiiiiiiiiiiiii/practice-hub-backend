import { AppUser } from '../../database/entities/app-user.entity';
import { UserCoupon } from '../../database/entities/user-coupon.entity';
import { RewardedAdService } from './rewarded-ad.service';

const createUserQueryBuilder = (user: Partial<AppUser>) => ({
	setLock: jest.fn().mockReturnThis(),
	where: jest.fn().mockReturnThis(),
	getOne: jest.fn().mockResolvedValue(user),
});

describe('RewardedAdService', () => {
	const activityDateParts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(new Date());
	const activityDate = `${activityDateParts.find((part) => part.type === 'year')?.value}-${activityDateParts.find((part) => part.type === 'month')?.value}-${activityDateParts.find((part) => part.type === 'day')?.value}`;

	const createCouponRepository = (dailyClaimedCount: number) => ({
		createQueryBuilder: jest.fn(() => ({
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			getCount: jest.fn().mockResolvedValue(dailyClaimedCount),
		})),
		create: jest.fn((value) => value),
		save: jest.fn(async (value) => value),
	});

	it('issues a coupon on every fifth completed view and starts the next round', async () => {
		const user = {
			id: 7,
			rewarded_ad_watch_count: 4,
			rewarded_ad_coupon_issued: false,
			rewarded_ad_activity_date: activityDate,
			rewarded_ad_daily_coupon_count: 1,
		} as AppUser;
		const appUserRepository = {
			createQueryBuilder: jest.fn(() => createUserQueryBuilder(user)),
			save: jest.fn(async (value) => value),
		};
		const couponRepository = createCouponRepository(1);
		const manager = {
			getRepository: jest.fn((entity) => (entity === AppUser ? appUserRepository : couponRepository)),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new RewardedAdService({} as any, dataSource as any);

		const result = await service.completeView(7);

		expect(result).toMatchObject({
			watchedCount: 0,
			remainingCount: 5,
			dailyClaimedCount: 2,
			dailyClaimLimit: 10,
			rewarded: false,
			couponIssuedNow: true,
		});
		expect(couponRepository.create).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 7,
				amount: 5,
				min_amount: 0,
				source: 'rewarded_ad',
			}),
		);
		expect(couponRepository.save).toHaveBeenCalledTimes(1);
		expect(appUserRepository.save).toHaveBeenCalledWith(
			expect.objectContaining({
				rewarded_ad_watch_count: 0,
				rewarded_ad_coupon_issued: false,
			}),
		);
	});

	it('converts the legacy one-time reward flag into a fresh repeatable round', async () => {
		const user = {
			id: 7,
			rewarded_ad_watch_count: 5,
			rewarded_ad_coupon_issued: true,
			rewarded_ad_activity_date: activityDate,
			rewarded_ad_daily_coupon_count: 1,
		} as AppUser;
		const appUserRepository = {
			createQueryBuilder: jest.fn(() => createUserQueryBuilder(user)),
			save: jest.fn(async (value) => value),
		};
		const couponRepository = createCouponRepository(1);
		const manager = {
			getRepository: jest.fn((entity) => (entity === AppUser ? appUserRepository : couponRepository)),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new RewardedAdService({} as any, dataSource as any);

		const result = await service.completeView(7);

		expect(result).toMatchObject({ watchedCount: 1, dailyClaimedCount: 1, rewarded: false });
		expect(couponRepository.save).not.toHaveBeenCalled();
		expect(appUserRepository.save).toHaveBeenCalledWith(
			expect.objectContaining({
				rewarded_ad_watch_count: 1,
				rewarded_ad_coupon_issued: false,
			}),
		);
	});

	it('does not record more views after ten coupons have been claimed today', async () => {
		const user = {
			id: 7,
			rewarded_ad_watch_count: 3,
			rewarded_ad_coupon_issued: false,
			rewarded_ad_activity_date: activityDate,
			rewarded_ad_daily_coupon_count: 10,
		} as AppUser;
		const appUserRepository = {
			createQueryBuilder: jest.fn(() => createUserQueryBuilder(user)),
			save: jest.fn(),
		};
		const couponRepository = createCouponRepository(10);
		const manager = {
			getRepository: jest.fn((entity) => (entity === AppUser ? appUserRepository : couponRepository)),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new RewardedAdService({} as any, dataSource as any);

		const result = await service.completeView(7);

		expect(result).toMatchObject({
			watchedCount: 3,
			dailyClaimedCount: 10,
			dailyLimitReached: true,
			rewarded: true,
			couponIssuedNow: false,
		});
		expect(couponRepository.save).not.toHaveBeenCalled();
		expect(appUserRepository.save).not.toHaveBeenCalled();
	});

	it('resets only the daily coupon counter on a new China calendar day', async () => {
		const user = {
			id: 7,
			rewarded_ad_watch_count: 2,
			rewarded_ad_coupon_issued: false,
			rewarded_ad_activity_date: '2020-01-01',
			rewarded_ad_daily_coupon_count: 10,
		} as AppUser;
		const appUserRepository = {
			createQueryBuilder: jest.fn(() => createUserQueryBuilder(user)),
			save: jest.fn(async (value) => value),
		};
		const couponRepository = createCouponRepository(0);
		const manager = {
			getRepository: jest.fn((entity) => (entity === AppUser ? appUserRepository : couponRepository)),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new RewardedAdService({} as any, dataSource as any);

		const result = await service.completeView(7);

		expect(result).toMatchObject({
			watchedCount: 3,
			dailyClaimedCount: 0,
			dailyLimitReached: false,
		});
		expect(appUserRepository.save).toHaveBeenCalledWith(
			expect.objectContaining({
				rewarded_ad_watch_count: 3,
				rewarded_ad_activity_date: activityDate,
				rewarded_ad_daily_coupon_count: 0,
			}),
		);
	});
});
