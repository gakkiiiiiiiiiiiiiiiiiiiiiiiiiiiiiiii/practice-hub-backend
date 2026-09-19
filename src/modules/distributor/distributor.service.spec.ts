import { BadRequestException } from '@nestjs/common';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { ActivationCode, ActivationCodeTargetType } from '../../database/entities/activation-code.entity';
import { DistributionRelation } from '../../database/entities/distribution-relation.entity';
import { DistributionOrder } from '../../database/entities/distribution-order.entity';
import { DistributorWithdrawal, DistributorWithdrawalStatus } from '../../database/entities/distributor-withdrawal.entity';
import { Distributor } from '../../database/entities/distributor.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { DistributorService } from './distributor.service';

const createSerializedTransaction = (manager: any) => {
	let queue = Promise.resolve();
	return jest.fn((callback: (transactionManager: any) => Promise<any>) => {
		const result = queue.then(() => callback(manager));
		queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	});
};

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
		service.distributionRelationRepository = {
			find: jest.fn().mockResolvedValue([]),
		};
		return service;
	};

	it('keeps the legacy null response for a user who has not applied', async () => {
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
		service.distributorRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(created);

		await expect(service.getDistributorInfo(607)).resolves.toEqual(expect.objectContaining({ status: 1, is_app_admin: true }));
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
			target_name: '高级代理身份',
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
			findOne: jest.fn().mockResolvedValue({
				id: 9,
				user_id: 607,
				distributor_code: 'D607',
				status: 1,
				agent_level: 2,
			}),
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
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({ is_enabled: 1 });

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
			findOne: jest.fn().mockResolvedValue({
				id: 9,
				user_id: 607,
				distributor_code: 'D607',
				status: 1,
				agent_level: 3,
			}),
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
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({ is_enabled: 1 });

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
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
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
			expect.objectContaining({
				distributor_id: 1,
				commission_type: 'base',
				commission_amount: 20,
			}),
			expect.objectContaining({
				distributor_id: 2,
				commission_type: 'direct_team',
				commission_amount: 6,
			}),
			expect.objectContaining({
				distributor_id: 3,
				commission_type: 'indirect_team',
				commission_amount: 4,
			}),
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
			expect.objectContaining({
				distributor_id: 1,
				commission_type: 'paper',
				commission_amount: 2,
			}),
		);
	});

	it('honors zero paper commission instead of falling back to one yuan', async () => {
		const { service, commissionRepository } = createCommissionService({
			id: 90,
			user_id: 10,
			amount: 999,
			status: 'paid',
			paid_time: new Date(),
			pay_payload: {
				fulfillment_type: 'paper',
				cart_items: [{ course_id: 7 }],
			},
		});
		service.getDistributionConfig.mockResolvedValue({
			paper_commission_per_kind: 0,
			commission_freeze_days: 0,
		});

		await service.processOrderCommission(90);

		expect(commissionRepository.save).not.toHaveBeenCalled();
	});

	it('honors a zero-day commission freeze', async () => {
		const paidTime = new Date('2026-09-18T00:00:00.000Z');
		const { service, commissionRepository } = createCommissionService({
			id: 92,
			user_id: 10,
			amount: 100,
			status: 'paid',
			paid_time: paidTime,
			pay_payload: {},
		});
		service.getDistributionConfig.mockResolvedValue({
			base_commission_rates: [20, 25, 30],
			direct_commission_rates: [5, 6, 8],
			indirect_commission_rates: [0, 3, 4],
			commission_freeze_days: 0,
		});

		await service.processOrderCommission(92);

		expect(commissionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ available_at: paidTime }));
	});

	it('does not generate commissions while distribution is disabled', async () => {
		const { service, commissionRepository } = createCommissionService({
			id: 91,
			user_id: 10,
			amount: 100,
			status: 'paid',
			paid_time: new Date(),
			pay_payload: {},
		});
		service.getDistributionConfig.mockResolvedValue({ is_enabled: 0 });

		await service.processOrderCommission(91);

		expect(commissionRepository.save).not.toHaveBeenCalled();
	});
});

describe('DistributorService distributor lifecycle', () => {
	it('opens a new distributor for free and approves it immediately', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const distributorRepository = {
			findOne: jest.fn().mockResolvedValue(null),
			create: jest.fn((payload) => payload),
			save: jest.fn((payload) => Promise.resolve(payload)),
		};
		service.distributorRepository = distributorRepository;
		const userQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn().mockResolvedValue({ id: 607 }),
		};
		userQueryBuilder.setLock.mockReturnValue(userQueryBuilder);
		userQueryBuilder.where.mockReturnValue(userQueryBuilder);
		const manager = {
			getRepository: jest.fn((entity) => (entity === Distributor ? distributorRepository : { createQueryBuilder: () => userQueryBuilder })),
		};
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		service.evaluateUplinePromotion = jest.fn().mockResolvedValue(undefined);
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({ is_enabled: 1 });

		await expect(service.applyDistributor(607)).resolves.toEqual(
			expect.objectContaining({
				message: '已免费开通初级代理',
				agent_level: 1,
			}),
		);
		expect(distributorRepository.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 607, status: 1, agent_level: 1 }));
		expect(service.evaluateUplinePromotion).toHaveBeenCalledWith(607, manager);
	});

	it('makes concurrent free opening idempotent', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		let storedDistributor: any = null;
		const distributorRepository = {
			findOne: jest.fn(async () => storedDistributor),
			create: jest.fn((payload) => payload),
			save: jest.fn(async (payload) => {
				storedDistributor = { id: 1, ...payload };
				return storedDistributor;
			}),
		};
		const userQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn().mockResolvedValue({ id: 607 }),
		};
		userQueryBuilder.setLock.mockReturnValue(userQueryBuilder);
		userQueryBuilder.where.mockReturnValue(userQueryBuilder);
		const manager = {
			getRepository: jest.fn((entity) => (entity === Distributor ? distributorRepository : { createQueryBuilder: () => userQueryBuilder })),
		};
		service.dataSource = { transaction: createSerializedTransaction(manager) };
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({ is_enabled: 1 });
		service.evaluateUplinePromotion = jest.fn().mockResolvedValue(undefined);

		const results = await Promise.all([service.applyDistributor(607), service.applyDistributor(607)]);

		expect(results).toHaveLength(2);
		expect(results.every((item) => item.agent_level === 1)).toBe(true);
		expect(distributorRepository.save).toHaveBeenCalledTimes(1);
	});

	it('prevents a cycle when two users bind each other concurrently', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const distributors = [
			{
				id: 1,
				user_id: 101,
				distributor_code: 'D101',
				status: 1,
				subordinate_count: 0,
			},
			{
				id: 2,
				user_id: 202,
				distributor_code: 'D202',
				status: 1,
				subordinate_count: 0,
			},
		];
		const relations: any[] = [];
		const distributorRepository = {
			findOne: jest.fn(async ({ where }) => distributors.find((item) => (where.id ? item.id === where.id : item.distributor_code === where.distributor_code)) || null),
			increment: jest.fn(async ({ id }) => {
				const distributor = distributors.find((item) => item.id === id);
				if (distributor) distributor.subordinate_count += 1;
			}),
		};
		const relationRepository = {
			findOne: jest.fn(async ({ where }) => relations.find((item) => item.user_id === where.user_id) || null),
			create: jest.fn((payload) => payload),
			save: jest.fn(async (payload) => {
				relations.push(payload);
				return payload;
			}),
		};
		const userQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			orderBy: jest.fn(),
			getMany: jest.fn().mockResolvedValue([]),
		};
		for (const method of ['setLock', 'where', 'orderBy']) userQueryBuilder[method].mockReturnValue(userQueryBuilder);
		const manager = {
			getRepository: jest.fn((entity) => {
				if (entity === Distributor) return distributorRepository;
				if (entity === DistributionRelation) return relationRepository;
				if (entity === AppUser) return { createQueryBuilder: () => userQueryBuilder };
			}),
		};
		service.dataSource = { transaction: createSerializedTransaction(manager) };
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({ max_level: 3, is_enabled: 1 });

		const results = await Promise.allSettled([service.bindDistributionRelation(101, 'D202'), service.bindDistributionRelation(202, 'D101')]);

		expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
		expect(relations).toHaveLength(1);
	});

	it('rejects binding a distributor to one of its own descendants', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const targetDistributor = { id: 10, user_id: 100, status: 1 };
		const descendantDistributor = {
			id: 20,
			user_id: 200,
			status: 1,
			distributor_code: 'D200',
			subordinate_count: 0,
		};
		const relationRepository = {
			findOne: jest.fn(({ where }) => {
				if (where.user_id === 100) return Promise.resolve(null);
				if (where.user_id === 200) return Promise.resolve({ user_id: 200, distributor_id: 10 });
				return Promise.resolve(null);
			}),
			create: jest.fn((payload) => payload),
			save: jest.fn(),
		};
		const distributorRepository = {
			findOne: jest.fn(({ where }) => {
				if (where.distributor_code === 'D200') return Promise.resolve(descendantDistributor);
				if (where.id === 10) return Promise.resolve(targetDistributor);
				return Promise.resolve(null);
			}),
			save: jest.fn(),
		};
		service.distributionRelationRepository = relationRepository;
		service.distributorRepository = distributorRepository;
		const userQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			orderBy: jest.fn(),
			getMany: jest.fn().mockResolvedValue([]),
		};
		for (const method of ['setLock', 'where', 'orderBy']) userQueryBuilder[method].mockReturnValue(userQueryBuilder);
		const manager = {
			getRepository: jest.fn((entity) => {
				if (entity === Distributor) return distributorRepository;
				if (entity === DistributionRelation) return relationRepository;
				return { createQueryBuilder: () => userQueryBuilder };
			}),
		};
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		service.assertDistributionEnabled = jest.fn().mockResolvedValue({ max_level: 3, is_enabled: 1 });

		await expect(service.bindDistributionRelation(100, 'D200')).rejects.toThrow('不能绑定自己的下级为上级');
		expect(service.distributionRelationRepository.save).not.toHaveBeenCalled();
		expect(service.assertDistributionEnabled).toHaveBeenCalled();
	});

	it('keeps a promoted distributor level permanently when direct counts later drop', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const upline = { id: 8, user_id: 80, status: 1, agent_level: 3 };
		service.distributionRelationRepository = {
			findOne: jest.fn().mockResolvedValueOnce({ user_id: 90, distributor_id: 8 }).mockResolvedValueOnce(null),
			find: jest.fn().mockResolvedValue([{ user_id: 91, distributor_id: 8 }]),
		};
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue(upline),
			find: jest.fn().mockResolvedValue([{ id: 9, user_id: 91, status: 1, agent_level: 1 }]),
			save: jest.fn(),
		};

		await service.evaluateUplinePromotion(90);

		expect(upline.agent_level).toBe(3);
		expect(service.distributorRepository.save).not.toHaveBeenCalled();
	});

	it('blocks free opening while the distribution switch is disabled', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		service.distributionConfigRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 1, is_enabled: 0 }),
		};
		service.distributorRepository = { findOne: jest.fn() };

		await expect(service.applyDistributor(607)).rejects.toThrow('分销系统暂未开放');
		expect(service.distributorRepository.findOne).not.toHaveBeenCalled();
	});

	it('reevaluates the upline when an admin approves an agent', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const distributor = {
			id: 7,
			user_id: 607,
			status: 0,
			agent_level: 1,
			reject_reason: '旧原因',
		};
		const queryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn().mockResolvedValue(distributor),
		};
		queryBuilder.setLock.mockReturnValue(queryBuilder);
		queryBuilder.where.mockReturnValue(queryBuilder);
		const repository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
			save: jest.fn((payload) => Promise.resolve(payload)),
		};
		const manager = { getRepository: jest.fn().mockReturnValue(repository) };
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};
		service.evaluateUplinePromotion = jest.fn().mockResolvedValue(undefined);

		await service.updateDistributorStatus(7, { status: 1 });

		expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(service.evaluateUplinePromotion).toHaveBeenCalledWith(607, manager);
		expect(distributor.reject_reason).toBeNull();
	});
});

describe('DistributorService money concurrency', () => {
	it('generates one activation-code batch across concurrent payment callbacks', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const codes: any[] = [];
		const activationCodeRepository = {
			count: jest.fn(async () => codes.length),
			create: jest.fn((payload) => payload),
			save: jest.fn(async (payloads) => {
				codes.push(...payloads);
				return payloads;
			}),
		};
		const orderQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn(),
		};
		orderQueryBuilder.setLock.mockReturnValue(orderQueryBuilder);
		orderQueryBuilder.where.mockReturnValue(orderQueryBuilder);
		const order = {
			id: 88,
			pay_payload: {
				activation_code_purchase: {
					batch_id: 'D-BATCH',
					distributor_id: 7,
					course_id: 10,
					count: 3,
				},
			},
		};
		orderQueryBuilder.getOne.mockResolvedValue(order);
		const manager = {
			getRepository: jest.fn((entity) => {
				if (entity === ActivationCode) return activationCodeRepository;
				if (entity === Order) return { createQueryBuilder: () => orderQueryBuilder };
			}),
		};
		service.dataSource = { transaction: createSerializedTransaction(manager) };
		service.generateActivationCode = jest.fn(() => `CODE-${codes.length}-${Math.random()}`);
		service.getBatchPrefix = jest.fn(() => 'D');

		const results = await Promise.all([service.fulfillActivationCodeOrder(order), service.fulfillActivationCodeOrder(order)]);

		expect(results.map((item) => item.count)).toEqual([3, 3]);
		expect(codes).toHaveLength(3);
		expect(activationCodeRepository.save).toHaveBeenCalledTimes(1);
	});

	it('settles the same due commission only once across concurrent requests', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const commission = {
			id: 1,
			order_id: 88,
			distributor_id: 7,
			commission_amount: 20,
			status: 0,
			available_at: new Date('2026-09-01T00:00:00.000Z'),
		};
		const queryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			andWhere: jest.fn(),
			orderBy: jest.fn(),
			getMany: jest.fn(async () => (commission.status === 0 ? [commission] : [])),
		};
		for (const method of ['setLock', 'where', 'andWhere', 'orderBy']) {
			queryBuilder[method].mockReturnValue(queryBuilder);
		}
		const commissionRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
			save: jest.fn((payload) => Promise.resolve(payload)),
		};
		const orderRepository = {
			find: jest.fn().mockResolvedValue([{ id: 88, status: OrderStatus.PAID }]),
		};
		const distributor = {
			id: 7,
			frozen_amount: 20,
			withdrawable_amount: 0,
			commission_debt_amount: 0,
		};
		const distributorQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn().mockResolvedValue(distributor),
		};
		distributorQueryBuilder.setLock.mockReturnValue(distributorQueryBuilder);
		distributorQueryBuilder.where.mockReturnValue(distributorQueryBuilder);
		const distributorRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(distributorQueryBuilder),
			save: jest.fn(),
		};
		const manager = {
			getRepository: jest.fn((entity) => {
				if (entity === DistributionOrder) return commissionRepository;
				if (entity === Order) return orderRepository;
				if (entity === Distributor) return distributorRepository;
				throw new Error(`Unexpected repository: ${entity?.name}`);
			}),
			increment: jest.fn().mockResolvedValue(undefined),
			decrement: jest.fn().mockResolvedValue(undefined),
		};
		service.dataSource = { transaction: createSerializedTransaction(manager) };

		await Promise.all([service.settleAvailableCommissions(7), service.settleAvailableCommissions(7)]);

		expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(commissionRepository.save).toHaveBeenCalledTimes(1);
		expect(distributorRepository.save).toHaveBeenCalledTimes(1);
		expect(distributor.withdrawable_amount).toBe(20);
		expect(commission.status).toBe(1);
	});

	it('allows only one concurrent withdrawal when the second would break the reserve', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const distributor = {
			id: 7,
			user_id: 607,
			status: 1,
			withdrawable_amount: 150,
			alipay_account: null,
			real_name: null,
		};
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue(distributor),
		};
		service.settleAvailableCommissions = jest.fn().mockResolvedValue(undefined);
		service.getDistributionConfig = jest.fn().mockResolvedValue({
			min_withdraw_amount: 100,
			withdraw_reserve_amount: 20,
			withdraw_fee_rate: 5,
		});
		const distributorQueryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn().mockImplementation(() => Promise.resolve(distributor)),
		};
		distributorQueryBuilder.setLock.mockReturnValue(distributorQueryBuilder);
		distributorQueryBuilder.where.mockReturnValue(distributorQueryBuilder);
		const distributorRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(distributorQueryBuilder),
			save: jest.fn((payload) => Promise.resolve(payload)),
		};
		const withdrawals: any[] = [];
		const withdrawalRepository = {
			create: jest.fn((payload) => payload),
			save: jest.fn(async (payload) => {
				withdrawals.push(payload);
				return { id: withdrawals.length, ...payload };
			}),
		};
		const manager = {
			getRepository: jest.fn((entity) => {
				if (entity === Distributor) return distributorRepository;
				if (entity === DistributorWithdrawal) return withdrawalRepository;
				throw new Error(`Unexpected repository: ${entity?.name}`);
			}),
		};
		service.dataSource = { transaction: createSerializedTransaction(manager) };
		const dto = {
			amount: 100,
			alipay_account: 'agent@example.com',
			real_name: '测试代理',
		};

		const results = await Promise.allSettled([service.createWithdrawal(607, dto), service.createWithdrawal(607, dto)]);

		expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
		expect((results.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
		expect(distributorQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(withdrawalRepository.save).toHaveBeenCalledTimes(1);
		expect(distributor.withdrawable_amount).toBe(50);
	});

	it('refunds a concurrently rejected withdrawal only once', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const withdrawal = {
			id: 11,
			distributor_id: 7,
			amount: 100,
			status: DistributorWithdrawalStatus.PENDING,
		};
		const queryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			getOne: jest.fn(async () => withdrawal),
		};
		queryBuilder.setLock.mockReturnValue(queryBuilder);
		queryBuilder.where.mockReturnValue(queryBuilder);
		const repository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
			save: jest.fn((payload) => Promise.resolve(payload)),
		};
		const manager = {
			getRepository: jest.fn().mockReturnValue(repository),
			increment: jest.fn().mockResolvedValue(undefined),
		};
		service.dataSource = { transaction: createSerializedTransaction(manager) };

		const results = await Promise.allSettled([service.updateWithdrawalStatus(11, DistributorWithdrawalStatus.REJECTED, 1, '重复请求'), service.updateWithdrawalStatus(11, DistributorWithdrawalStatus.REJECTED, 2, '重复请求')]);

		expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
		expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(manager.increment).toHaveBeenCalledTimes(1);
	});

	it('locks commission rows before refund cancellation', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const queryBuilder: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			orderBy: jest.fn(),
			getMany: jest.fn().mockResolvedValue([]),
		};
		for (const method of ['setLock', 'where', 'orderBy']) queryBuilder[method].mockReturnValue(queryBuilder);
		const repository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
		};
		const manager = { getRepository: jest.fn().mockReturnValue(repository) };
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};

		await service.cancelOrderCommission(88);

		expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(queryBuilder.orderBy).toHaveBeenCalledWith('commission.id', 'ASC');
	});

	it('records withdrawn refunded commission as debt instead of a negative balance', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const commission = {
			id: 1,
			order_id: 88,
			distributor_id: 7,
			commission_amount: 20,
			status: 1,
		};
		const commissionQuery: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			orderBy: jest.fn(),
			getMany: jest.fn().mockResolvedValue([commission]),
		};
		for (const method of ['setLock', 'where', 'orderBy']) commissionQuery[method].mockReturnValue(commissionQuery);
		const distributor = {
			id: 7,
			total_earnings: 20,
			frozen_amount: 0,
			withdrawable_amount: 5,
			commission_debt_amount: 0,
		};
		const distributorQuery: any = {
			setLock: jest.fn(),
			where: jest.fn(),
			orderBy: jest.fn(),
			getMany: jest.fn().mockResolvedValue([distributor]),
		};
		for (const method of ['setLock', 'where', 'orderBy']) distributorQuery[method].mockReturnValue(distributorQuery);
		const commissionRepository = {
			createQueryBuilder: () => commissionQuery,
			save: jest.fn(),
		};
		const distributorRepository = {
			createQueryBuilder: () => distributorQuery,
			save: jest.fn(),
		};
		const manager = {
			getRepository: jest.fn((entity) => (entity === DistributionOrder ? commissionRepository : distributorRepository)),
		};
		service.dataSource = {
			transaction: jest.fn((callback) => callback(manager)),
		};

		await service.cancelOrderCommission(88);

		expect(distributor.withdrawable_amount).toBe(0);
		expect(distributor.commission_debt_amount).toBe(15);
		expect(distributor.total_earnings).toBe(0);
		expect(commission.status).toBe(2);
	});
});

describe('DistributorService configuration compatibility', () => {
	it('preserves explicit zero withdrawal settings in the public response', async () => {
		const service = Object.create(DistributorService.prototype) as any;
		const distributor = {
			id: 7,
			user_id: 607,
			status: 1,
			agent_level: 1,
			total_earnings: 0,
			withdrawable_amount: 0,
			frozen_amount: 0,
		};
		service.distributorRepository = {
			findOne: jest.fn().mockResolvedValue(distributor),
			find: jest.fn().mockResolvedValue([]),
		};
		service.appUserRepository = {
			findOne: jest.fn().mockResolvedValue({ id: 607, role: AppUserRole.USER }),
		};
		service.distributionRelationRepository = {
			find: jest.fn().mockResolvedValue([]),
		};
		service.getDistributionConfig = jest.fn().mockResolvedValue({
			is_enabled: 1,
			min_withdraw_amount: 0,
			withdraw_reserve_amount: 0,
			withdraw_fee_rate: 0,
			commission_freeze_days: 0,
		});
		service.settleAvailableCommissions = jest.fn().mockResolvedValue(undefined);

		const result = await service.getDistributorInfo(607);

		expect(result.withdraw_rules).toEqual({
			minimum: 0,
			reserve: 0,
			fee_rate: 0,
			freeze_days: 0,
		});
		expect(result.is_enabled).toBe(true);
	});
});
