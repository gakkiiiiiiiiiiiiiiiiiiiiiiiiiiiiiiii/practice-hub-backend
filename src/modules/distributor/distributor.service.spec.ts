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
		service.settleAvailableCommissions = jest.fn();
		service.getDistributionConfig = jest.fn().mockResolvedValue({
			min_withdraw_amount: 100,
			withdraw_reserve_amount: 20,
			withdraw_fee_rate: 5,
			commission_freeze_days: 15,
		});
		service.distributionRelationRepository = { find: jest.fn().mockResolvedValue([]) };
		return service;
	};

	it('returns an empty state instead of a 404 for a user who has not applied', async () => {
		const service = createService();

		await expect(service.getDistributorInfo(607)).resolves.toBeNull();
		expect(service.createApprovedDistributorForUser).not.toHaveBeenCalled();
	});

	it('keeps automatically provisioning an approved distributor for an app admin', async () => {
		const service = createService(AppUserRole.ADMIN);
		const created = {
			id: 10,
			distributor_code: 'D607',
			qr_code_url: null,
			status: 1,
			total_earnings: 0,
			withdrawable_amount: 0,
			subordinate_count: 0,
			total_orders: 0,
			agent_level: 1,
		};
		service.createApprovedDistributorForUser.mockResolvedValue(created);
		service.distributorRepository.findOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(created);

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
				reward_payload: { agent_level: 3 },
			}),
		).resolves.toMatchObject({
			count: 2,
			codes: [expect.any(String), expect.any(String)],
			target_type: ActivationCodeTargetType.AGENT,
			target_name: '三级代理身份',
		});
		expect(service.activationCodeRepository.save).toHaveBeenCalledWith(
			expect.arrayContaining([
					expect.objectContaining({
						target_type: ActivationCodeTargetType.AGENT,
						course_id: null,
						reward_payload: { agent_level: 3 },
				}),
			]),
		);
	});

	it('keeps the legacy purchase endpoint but charges the original course price', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 9, user_id: 607, distributor_code: 'D607', status: 1, agent_level: 2 }),
		};
		service.courseRepository = {
			findOne: jest.fn().mockResolvedValue({
				id: 12,
				name: '护理学',
				price: 20,
				agent_price: 6,
				agent_prices: { '1': 6, '2': 4, '3': 3 },
			}),
		};
		service.orderRepository = {
			create: jest.fn((payload) => payload),
			save: jest.fn().mockResolvedValue(undefined),
		};
		service.orderService = {
			startCoinPaymentForOrder: jest.fn().mockResolvedValue({ payment_params: { mode: 'test' } }),
		};
		service.agentPricePolicyService = {
			getCoursePrice: jest.fn().mockResolvedValue({
				unitPrice: 4,
				excluded: false,
				pricingMode: 'agent',
			}),
		};

		await expect(service.buyActivationCodes(607, 12, 3)).resolves.toMatchObject({
			count: 3,
			total_price: 60,
			agent_level: 2,
			agent_price_excluded: true,
			pricing_mode: 'original_compat',
		});
		expect(service.orderRepository.create).toHaveBeenCalledWith(
			expect.objectContaining({
				amount: 60,
				original_amount: 60,
				pay_payload: expect.objectContaining({
					activation_code_purchase: expect.objectContaining({
						unit_price: 20,
						agent_level: 2,
						pricing_mode: 'original_compat',
					}),
				}),
			}),
		);
	});

	it('forces the original price when the course is excluded from agent pricing', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 9, user_id: 607, distributor_code: 'D607', status: 1, agent_level: 3 }),
		};
		service.courseRepository = {
			findOne: jest.fn().mockResolvedValue({
				id: 12,
				name: '护理学',
				price: 20,
				agent_price: 6,
				agent_prices: { '1': 6, '2': 4, '3': 3 },
			}),
		};
		service.orderRepository = {
			create: jest.fn((payload) => payload),
			save: jest.fn().mockResolvedValue(undefined),
		};
		service.orderService = {
			startCoinPaymentForOrder: jest.fn().mockResolvedValue({ payment_params: { mode: 'test' } }),
		};
		service.agentPricePolicyService = {
			getCoursePrice: jest.fn().mockResolvedValue({
				unitPrice: 20,
				excluded: true,
				pricingMode: 'original',
			}),
		};

		await expect(service.buyActivationCodes(607, 12, 2)).resolves.toMatchObject({
			count: 2,
			total_price: 40,
			agent_level: 3,
			agent_price_excluded: true,
			pricing_mode: 'original_compat',
		});
		expect(service.orderRepository.create).toHaveBeenCalledWith(
			expect.objectContaining({
				amount: 40,
				pay_payload: expect.objectContaining({
					activation_code_purchase: expect.objectContaining({
						unit_price: 20,
						agent_price_excluded: true,
						pricing_mode: 'original_compat',
					}),
				}),
			}),
		);
	});
});

describe('DistributorService commission rules', () => {
	const createCommissionService = (order: Record<string, any>) => {
		const service = Object.create(DistributorService.prototype) as any;
		const distributors = new Map([
			[1, { id: 1, user_id: 20, status: 1, agent_level: 1 }],
			[2, { id: 2, user_id: 30, status: 1, agent_level: 2 }],
			[3, { id: 3, user_id: 40, status: 1, agent_level: 3 }],
		]);
		const relationByUser = new Map([
			[10, { user_id: 10, distributor_id: 1 }],
			[20, { user_id: 20, distributor_id: 2 }],
			[30, { user_id: 30, distributor_id: 3 }],
		]);
		service.orderRepository = { findOne: jest.fn().mockResolvedValue(order) };
		service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
		service.distributionRelationRepository = {
			findOne: jest.fn(({ where }) => Promise.resolve(relationByUser.get(where.user_id) || null)),
		};
		service.distributorRepository = {
			findOne: jest.fn(({ where }) => Promise.resolve(distributors.get(where.id) || null)),
		};
		service.getDistributionConfig = jest.fn().mockResolvedValue({
			base_commission_rates: [20, 25, 30],
			direct_commission_rates: [5, 6, 8],
			indirect_commission_rates: [0, 3, 4],
			paper_commission_per_kind: 1,
			commission_freeze_days: 15,
		});
		const commissionRepository = {
			findOne: jest.fn().mockResolvedValue(null),
			create: jest.fn((payload) => payload),
			save: jest.fn((payload) => Promise.resolve(payload)),
		};
		const manager = {
			getRepository: jest.fn().mockReturnValue(commissionRepository),
			increment: jest.fn().mockResolvedValue(undefined),
		};
		service.dataSource = { transaction: jest.fn((callback) => callback(manager)) };
		return { service, commissionRepository };
	};

	it('calculates online commissions from the paid order amount using recipient levels', async () => {
		const paidTime = new Date('2026-09-01T00:00:00.000Z');
		const { service, commissionRepository } = createCommissionService({
			id: 88,
			user_id: 10,
			amount: 100,
			status: 'paid',
			paid_time: paidTime,
			pay_payload: {},
		});

		await service.processOrderCommission(88);

		expect(commissionRepository.save.mock.calls.map(([payload]) => payload)).toEqual([
			expect.objectContaining({ distributor_id: 1, commission_type: 'base', commission_amount: 20 }),
			expect.objectContaining({ distributor_id: 2, commission_type: 'direct_team', commission_amount: 6 }),
			expect.objectContaining({ distributor_id: 3, commission_type: 'indirect_team', commission_amount: 4 }),
		]);
	});

	it('pays paper commission once per distinct kind only to the direct inviter', async () => {
		const { service, commissionRepository } = createCommissionService({
			id: 89,
			user_id: 10,
			amount: 999,
			status: 'paid',
			paid_time: new Date(),
			pay_payload: {
				fulfillment_type: 'paper',
				cart_items: [{ course_id: 7 }, { course_id: 7 }, { course_id: 8 }],
			},
		});

		await service.processOrderCommission(89);

		expect(commissionRepository.save).toHaveBeenCalledTimes(1);
		expect(commissionRepository.save).toHaveBeenCalledWith(
			expect.objectContaining({ distributor_id: 1, commission_type: 'paper', commission_amount: 2 }),
		);
	});
});
