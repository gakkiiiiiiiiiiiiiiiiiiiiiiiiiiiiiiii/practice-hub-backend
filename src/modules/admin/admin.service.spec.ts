import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { Distributor } from '../../database/entities/distributor.entity';
import { AdminService } from './admin.service';

describe('AdminService user list role filter', () => {
	it('applies the mini-program role condition before paging the user list', async () => {
		const queryBuilder = {
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			getCount: jest.fn().mockResolvedValue(1),
			orderBy: jest.fn().mockReturnThis(),
			skip: jest.fn().mockReturnThis(),
			take: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue([
				{
					id: 7,
					nickname: '测试管理员',
					role: AppUserRole.ADMIN,
					points_balance: 0,
					create_time: new Date(),
					update_time: new Date(),
				},
			]),
		};
		const service = Object.create(AdminService.prototype) as any;
		service.appUserRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
		};

		const result = await service.getUserList({ role: AppUserRole.ADMIN });

		expect(queryBuilder.andWhere).toHaveBeenCalledWith('user.role = :role', {
			role: AppUserRole.ADMIN,
		});
		expect(result.list).toHaveLength(1);
		expect(result.list[0].role).toBe(AppUserRole.ADMIN);
	});
});

describe('AdminService updateUserRole', () => {
	const createService = (user: any) => {
		const manager = {
			findOne: jest.fn().mockResolvedValue(user),
			save: jest.fn().mockResolvedValue(user),
			delete: jest.fn().mockResolvedValue({ affected: 1 }),
		};
		const service = Object.create(AdminService.prototype) as any;
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		return { service, manager };
	};

	it('clears only pending or rejected distributor applications when granting app admin', async () => {
		const { service, manager } = createService({ id: 1094, role: AppUserRole.BANK_ADMIN });

		await expect(service.updateUserRole(1094, AppUserRole.ADMIN)).resolves.toMatchObject({
			role: AppUserRole.ADMIN,
			isAppAdmin: true,
			clearedDistributorApplicationCount: 1,
		});
		expect(manager.findOne).toHaveBeenCalledWith(
			AppUser,
			expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
		);
		expect(manager.save).toHaveBeenCalledWith(AppUser, expect.objectContaining({ role: AppUserRole.ADMIN }));
		expect(manager.delete).toHaveBeenCalledWith(
			Distributor,
			expect.objectContaining({ user_id: 1094 }),
		);
		const deleteWhere = manager.delete.mock.calls[0][1];
		expect(deleteWhere.status.value).toEqual([0, 2]);
	});

	it('does not clear distributor records when granting bank admin', async () => {
		const { service, manager } = createService({ id: 1094, role: AppUserRole.USER });

		await expect(service.updateUserRole(1094, AppUserRole.BANK_ADMIN)).resolves.toMatchObject({
			role: AppUserRole.BANK_ADMIN,
			isBankAdmin: true,
			clearedDistributorApplicationCount: 0,
		});
		expect(manager.delete).not.toHaveBeenCalled();
	});
});
