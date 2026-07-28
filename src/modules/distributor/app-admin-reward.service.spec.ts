import { ForbiddenException } from '@nestjs/common';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { UserPointsLog } from '../../database/entities/user-points-log.entity';
import { AppAdminRewardService } from './app-admin-reward.service';

describe('AppAdminRewardService', () => {
	it('rejects reward operations from non-admin mini-program accounts', async () => {
		const appUserRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 1, role: AppUserRole.USER }),
		};
		const service = new AppAdminRewardService(appUserRepository as any, {} as any, {} as any);

		await expect(service.getTargetUser(1, 9)).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('locks the target account and writes a points ledger entry', async () => {
		const requester = { id: 1, role: AppUserRole.ADMIN } as AppUser;
		const target = {
			id: 9,
			nickname: '测试用户',
			phone: '13800138000',
			points_balance: 20,
		} as AppUser;
		const appUserRepository = {
			findOne: jest.fn().mockResolvedValue(requester),
		};
		const manager = {
			findOne: jest.fn().mockResolvedValue(target),
			save: jest.fn(async (_entity, value) => value),
			create: jest.fn((_entity, value) => value),
		};
		const dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		const service = new AppAdminRewardService(appUserRepository as any, dataSource as any, {} as any);

		const result = await service.grantPoints(1, 9, { amount: 100, remark: '活动奖励' });

		expect(result).toMatchObject({
			id: 9,
			grantedAmount: 100,
			pointsBalance: 120,
			phone: '138****8000',
		});
		expect(manager.findOne).toHaveBeenCalledWith(
			AppUser,
			expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
		);
		expect(manager.save).toHaveBeenCalledWith(
			UserPointsLog,
			expect.objectContaining({
				userId: 9,
				changeAmount: 100,
				balanceAfter: 120,
				remark: '活动奖励',
			}),
		);
	});

	it('reuses the existing coupon issuance service after the admin check', async () => {
		const appUserRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 1, role: AppUserRole.ADMIN }),
		};
		const referralCouponService = {
			issueCouponsByAdmin: jest.fn().mockResolvedValue({ issuedCount: 2 }),
		};
		const service = new AppAdminRewardService(
			appUserRepository as any,
			{} as any,
			referralCouponService as any,
		);
		const dto = { user_id: 9, amount: 5, min_amount: 0, count: 2, valid_days: 365 };

		await expect(service.issueCoupons(1, dto)).resolves.toEqual({ issuedCount: 2 });
		expect(referralCouponService.issueCouponsByAdmin).toHaveBeenCalledWith(dto);
	});
});
