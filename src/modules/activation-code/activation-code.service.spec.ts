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
});
