import { ConflictException } from '@nestjs/common';
import { UserService } from './user.service';

describe('UserService bindPhone', () => {
  it('rejects a phone number already bound to another account', async () => {
    const appUserRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: 597, phone: null })
        .mockResolvedValueOnce({ id: 579, phone: '15700006418' }),
      save: jest.fn(),
    };
    const service = new UserService(appUserRepository as any, null, null);

    await expect(service.bindPhone(597, { phone: '15700006418' })).rejects.toEqual(
      new ConflictException('该手机号已绑定其他账号'),
    );
    expect(appUserRepository.save).not.toHaveBeenCalled();
  });
});
