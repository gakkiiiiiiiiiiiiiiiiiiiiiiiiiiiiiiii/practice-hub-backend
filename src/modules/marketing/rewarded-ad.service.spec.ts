import { AppUser } from '../../database/entities/app-user.entity';
import { UserCoupon } from '../../database/entities/user-coupon.entity';
import { RewardedAdService } from './rewarded-ad.service';

const createQueryBuilder = (user: Partial<AppUser>) => ({
	setLock: jest.fn().mockReturnThis(),
	where: jest.fn().mockReturnThis(),
	getOne: jest.fn().mockResolvedValue(user),
});

describe('RewardedAdService', () => {
	it('issues one 5 yuan coupon when the fifth completed view is recorded', async () => {
		const user = {
			id: 7,
			rewarded_ad_watch_count: 4,
			rewarded_ad_coupon_issued: false,
		} as AppUser;
		const appUserRepository = {
			createQueryBuilder: jest.fn(() => createQueryBuilder(user)),
			save: jest.fn(async (value) => value),
		};
		const couponRepository = {
			create: jest.fn((value) => value),
			save: jest.fn(async (value) => value),
		};
		const manager = {
			getRepository: jest.fn((entity) => (entity === AppUser ? appUserRepository : couponRepository)),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new RewardedAdService({} as any, dataSource as any);

		const result = await service.completeView(7);

		expect(result).toMatchObject({
			watchedCount: 5,
			remainingCount: 0,
			rewarded: true,
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
				rewarded_ad_watch_count: 5,
				rewarded_ad_coupon_issued: true,
			}),
		);
	});

	it('does not issue another coupon after the reward has already been claimed', async () => {
		const user = {
			id: 7,
			rewarded_ad_watch_count: 5,
			rewarded_ad_coupon_issued: true,
		} as AppUser;
		const appUserRepository = {
			createQueryBuilder: jest.fn(() => createQueryBuilder(user)),
			save: jest.fn(),
		};
		const couponRepository = {
			create: jest.fn(),
			save: jest.fn(),
		};
		const manager = {
			getRepository: jest.fn((entity) => (entity === AppUser ? appUserRepository : couponRepository)),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new RewardedAdService({} as any, dataSource as any);

		const result = await service.completeView(7);

		expect(result).toMatchObject({ watchedCount: 5, rewarded: true });
		expect(couponRepository.save).not.toHaveBeenCalled();
		expect(appUserRepository.save).not.toHaveBeenCalled();
	});
});
