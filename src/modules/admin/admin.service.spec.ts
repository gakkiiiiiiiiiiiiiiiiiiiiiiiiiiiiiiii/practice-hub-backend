import { AdminService } from './admin.service';
import { AppUserRole } from '../../database/entities/app-user.entity';

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
