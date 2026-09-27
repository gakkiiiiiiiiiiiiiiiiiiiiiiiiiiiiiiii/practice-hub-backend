import { ActivationCodeService } from './activation-code.service';
import { ActivationCodeStatus, ActivationCodeTargetType } from '../../database/entities/activation-code.entity';

describe('ActivationCodeService', () => {
  const createService = (activationCode: any) =>
    new ActivationCodeService(
      { findOne: jest.fn().mockResolvedValue(activationCode) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        assertDistributionEnabled: jest.fn().mockResolvedValue({ is_enabled: 1 }),
        evaluateUplinePromotion: jest.fn().mockResolvedValue(undefined),
      } as any,
    );

  it('previews points activation codes', async () => {
    const service = createService({
      code: 'ABCD-EFGH-JKLM',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.POINTS,
      reward_payload: { points_amount: 200 },
    });

    await expect(service.previewCode('ABCD-EFGH-JKLM')).resolves.toMatchObject({
      target_type: ActivationCodeTargetType.POINTS,
      points_amount: 200,
    });
  });

  it('previews coupon activation codes', async () => {
    const service = createService({
      code: 'ABCD-EFGH-JKLM',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.COUPON,
      reward_payload: {
        coupon_amount: 5,
        coupon_min_amount: 0,
        coupon_valid_days: 30,
      },
    });

    await expect(service.previewCode('ABCD-EFGH-JKLM')).resolves.toMatchObject({
      target_type: ActivationCodeTargetType.COUPON,
      coupon_amount: 5,
      coupon_min_amount: 0,
      coupon_valid_days: 30,
    });
  });

  it('previews category bundle activation codes', async () => {
    const service = new ActivationCodeService(
      {
        findOne: jest.fn().mockResolvedValue({
          code: 'ABCD-EFGH-JKLM',
          status: ActivationCodeStatus.PENDING,
          target_type: ActivationCodeTargetType.CATEGORY_BUNDLE,
          target_id: 12,
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({
            id: 12,
            name: '内科护理',
            parent_id: 3,
            status: 1,
            bundle_enabled: 1,
          })
          .mockResolvedValueOnce({ id: 3, name: '护理学' }),
      } as any,
      {} as any,
      {
        assertDistributionEnabled: jest.fn().mockResolvedValue({ is_enabled: 1 }),
        evaluateUplinePromotion: jest.fn().mockResolvedValue(undefined),
      } as any,
    );

    await expect(service.previewCode('ABCD-EFGH-JKLM')).resolves.toMatchObject({
      target_type: ActivationCodeTargetType.CATEGORY_BUNDLE,
      category_id: 12,
      category_bundle_name: '护理学 / 内科护理',
    });
  });

  it('previews agent identity activation codes', async () => {
    const service = createService({
      code: 'AGNT-EFGH-JKLM',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.AGENT,
      reward_payload: { agent_level: 2 },
    });

    await expect(service.previewCode('AGNT-EFGH-JKLM')).resolves.toMatchObject({
      target_type: ActivationCodeTargetType.AGENT,
      identity_name: '中级代理',
      agent_level: 2,
      agent_level_name: '中级代理',
      benefits: expect.arrayContaining(['按代理商价格购买课程激活码']),
    });
  });

  it('creates an approved distributor when an agent code is redeemed', async () => {
    const service = createService(null);
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((_entity, payload) => payload),
      save: jest.fn((_entity, payload) => Promise.resolve({ id: 9, ...payload })),
    };

    await expect(
      (service as any).grantAgentByCode(manager, 607, {
        reward_payload: { agent_level: 2 },
      }),
    ).resolves.toMatchObject({
      user_id: 607,
      status: 1,
      agent_level: 2,
      distributor_code: expect.stringMatching(/^D607/),
    });
  });

  it('reevaluates the upline inside the agent-code redemption transaction', async () => {
    const service = createService(null) as any;
    const activationCode = {
      id: 1,
      code: 'AGNT-EFGH-JKLM',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.AGENT,
      reward_payload: { agent_level: 1 },
    };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(activationCode).mockResolvedValueOnce(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((_entity, payload) => payload),
      save: jest.fn((_entity, payload) => Promise.resolve({ id: 9, ...payload })),
    };
    const queryRunner = {
      manager,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    service.dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    await expect(service.redeemCode(607, activationCode.code)).resolves.toMatchObject({ is_agent: true });

    expect(service.distributorService.assertDistributionEnabled).toHaveBeenCalled();
    expect(service.distributorService.evaluateUplinePromotion).toHaveBeenCalledWith(607, manager);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('does not consume a course code when the user already owns the course', async () => {
    const service = createService(null) as any;
    const activationCode = {
      id: 2,
      code: 'CRSE-EFGH-JKLM',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.COURSE,
      course_id: 447,
      course: { id: 447, name: '机械设计基础' },
    };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(activationCode)
        .mockResolvedValueOnce({ id: 1620 })
        .mockResolvedValueOnce({ id: 2284, user_id: 1620, course_id: 447 }),
      update: jest.fn(),
    };
    const queryRunner = {
      manager,
      isTransactionActive: true,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    service.dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    await expect(service.redeemCode(1620, activationCode.code)).rejects.toThrow('您已拥有该资料，激活码未消耗');

    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenNthCalledWith(2, expect.anything(), {
      where: { id: 1620 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('commits course redemption before retrying preview demand after a deadlock', async () => {
    const service = createService(null) as any;
    const activationCode = {
      id: 3,
      code: 'CRSE-MNOP-QRST',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.COURSE,
      course_id: 447,
      course: { id: 447, name: '机械设计基础' },
    };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(activationCode)
        .mockResolvedValueOnce({ id: 1620 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue({ id: 2285, user_id: 1620, course_id: 447 }),
    };
    const postCommitQuery = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Deadlock found when trying to get lock'), {
          code: 'ER_LOCK_DEADLOCK',
          errno: 1213,
        }),
      )
      .mockResolvedValueOnce({ affectedRows: 1 });
    const queryRunner = {
      manager,
      isTransactionActive: true,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    service.dataSource = {
      manager: { query: postCommitQuery },
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    await expect(service.redeemCode(1620, activationCode.code)).resolves.toMatchObject({
      success: true,
      course_id: 447,
    });

    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(postCommitQuery).toHaveBeenCalledTimes(2);
    expect(queryRunner.commitTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      postCommitQuery.mock.invocationCallOrder[0],
    );
  });

  it('keeps a successful redemption successful when preview demand cannot be queued', async () => {
    const service = createService(null) as any;
    const activationCode = {
      id: 4,
      code: 'CRSE-UVWX-YZ23',
      status: ActivationCodeStatus.PENDING,
      target_type: ActivationCodeTargetType.COURSE,
      course_id: 448,
      course: { id: 448, name: '机械设计题库' },
    };
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(activationCode)
        .mockResolvedValueOnce({ id: 1620 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue({ id: 2286, user_id: 1620, course_id: 448 }),
    };
    const queryRunner = {
      manager,
      isTransactionActive: true,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    service.dataSource = {
      manager: {
        query: jest.fn().mockRejectedValue(new Error('preview queue unavailable')),
      },
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    await expect(service.redeemCode(1620, activationCode.code)).resolves.toMatchObject({
      success: true,
      course_id: 448,
    });
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });
});
