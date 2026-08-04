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
          .mockResolvedValueOnce({ id: 12, name: '内科护理', parent_id: 3, status: 1, bundle_enabled: 1 })
          .mockResolvedValueOnce({ id: 3, name: '护理学' }),
      } as any,
      {} as any,
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
      identity_name: '二级代理',
	  agent_level: 2,
	  agent_level_name: '二级代理',
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

	await expect((service as any).grantAgentByCode(manager, 607, { reward_payload: { agent_level: 2 } })).resolves.toMatchObject({
      user_id: 607,
      status: 1,
	  agent_level: 2,
      distributor_code: expect.stringMatching(/^D607/),
    });
  });
});
