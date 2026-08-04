import { AppUserRole } from '../../database/entities/app-user.entity';
import { ActivationCodeTargetType } from '../../database/entities/activation-code.entity';
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

describe('DistributorService agent identity activation codes', () => {
	it('allows an app super admin to generate agent identity codes', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		service.appUserRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 607, role: AppUserRole.ADMIN }),
		};
		service.activationCodeRepository = {
			create: jest.fn((payload) => payload),
			save: jest.fn((codes) => Promise.resolve(codes)),
		};

		await expect(
			service.generateAdminActivationCodes(607, {
				target_type: ActivationCodeTargetType.AGENT,
				count: 2,
			}),
		).resolves.toMatchObject({
			count: 2,
			codes: [expect.any(String), expect.any(String)],
			target_type: ActivationCodeTargetType.AGENT,
			target_name: '一级代理身份',
		});
		expect(service.activationCodeRepository.save).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					target_type: ActivationCodeTargetType.AGENT,
					course_id: null,
				}),
			]),
		);
	});

	it('charges an approved agent using the course agent price', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 9, user_id: 607, distributor_code: 'D607', status: 1 }),
		};
		service.courseRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 12, name: '护理学', price: 20, agent_price: 6 }),
		};
		service.orderRepository = {
			create: jest.fn((payload) => payload),
			save: jest.fn().mockResolvedValue(undefined),
		};
		service.orderService = {
			startCoinPaymentForOrder: jest.fn().mockResolvedValue({ payment_params: { mode: 'test' } }),
		};

		await expect(service.buyActivationCodes(607, 12, 3)).resolves.toMatchObject({
			count: 3,
			total_price: 18,
		});
		expect(service.orderRepository.create).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 18, original_amount: 18 }),
		);
	});
});
