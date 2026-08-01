import { AppUserRole } from '../../database/entities/app-user.entity';
import { DistributorService } from './distributor.service';

describe('DistributorService getDistributorInfo', () => {
	const createService = (role = AppUserRole.USER) => {
		const service = Object.create(DistributorService.prototype) as any;
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		service.appUserRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 607, role }),
		};
		service.createApprovedDistributorForUser = jest.fn();
		return service;
	};

	it('returns an empty state instead of a 404 for a user who has not applied', async () => {
		const service = createService();

		await expect(service.getDistributorInfo(607)).resolves.toBeNull();
		expect(service.createApprovedDistributorForUser).not.toHaveBeenCalled();
	});

	it('keeps automatically provisioning an approved distributor for an app admin', async () => {
		const service = createService(AppUserRole.ADMIN);
		service.createApprovedDistributorForUser.mockResolvedValue({
			id: 10,
			distributor_code: 'D607',
			qr_code_url: null,
			status: 1,
			total_earnings: 0,
			withdrawable_amount: 0,
			subordinate_count: 0,
			total_orders: 0,
		});

		await expect(service.getDistributorInfo(607)).resolves.toEqual(
			expect.objectContaining({ status: 1, is_app_admin: true }),
		);
	});
});
