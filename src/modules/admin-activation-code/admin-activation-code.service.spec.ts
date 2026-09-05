import { AdminActivationCodeService } from './admin-activation-code.service';
import { ActivationCodeSourceType, ActivationCodeStatus } from '../../database/entities/activation-code.entity';
import { AdminRole } from '../../database/entities/sys-user.entity';

describe('AdminActivationCodeService', () => {
  const createCountBuilder = (count: number) => {
    const builder: any = {
      andWhere: jest.fn(),
      getCount: jest.fn().mockResolvedValue(count),
    };
    builder.andWhere.mockReturnValue(builder);
    return builder;
  };

  it('returns activation code counts grouped by generator user', async () => {
    const groupedBuilder: any = {
      select: jest.fn(),
      addSelect: jest.fn(),
      setParameters: jest.fn(),
      groupBy: jest.fn(),
      addGroupBy: jest.fn(),
      orderBy: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          source_type: ActivationCodeSourceType.ADMIN,
          source_id: '7',
          total: '6',
          pending: '2',
          used: '3',
          invalid: '1',
        },
        {
          source_type: ActivationCodeSourceType.DISTRIBUTOR,
          source_id: '11',
          total: '4',
          pending: '1',
          used: '3',
          invalid: '0',
        },
      ]),
    };
    groupedBuilder.select.mockReturnValue(groupedBuilder);
    groupedBuilder.addSelect.mockReturnValue(groupedBuilder);
    groupedBuilder.setParameters.mockReturnValue(groupedBuilder);
    groupedBuilder.groupBy.mockReturnValue(groupedBuilder);
    groupedBuilder.addGroupBy.mockReturnValue(groupedBuilder);
    groupedBuilder.orderBy.mockReturnValue(groupedBuilder);

    const queryBuilder: any = {
      getCount: jest.fn().mockResolvedValue(10),
      clone: jest
        .fn()
        .mockReturnValueOnce(createCountBuilder(3))
        .mockReturnValueOnce(createCountBuilder(6))
        .mockReturnValueOnce(createCountBuilder(1))
        .mockReturnValueOnce(groupedBuilder),
    };
    const activationCodeRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const sysUserRepository = {
      find: jest.fn().mockResolvedValue([{ id: 7, username: 'admin-seven' }]),
    };
    const appUserRepository = { find: jest.fn().mockResolvedValue([]) };
    const distributorRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 11,
          distributor_code: 'DST-11',
          user: { nickname: '分销用户十一' },
        },
      ]),
    };

    const service = new AdminActivationCodeService(
      activationCodeRepository as any,
      sysUserRepository as any,
      appUserRepository as any,
      distributorRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.getCodeStatistics(1, AdminRole.SUPER_ADMIN)).resolves.toEqual({
      total: 10,
      pending: 3,
      used: 6,
      invalid: 1,
      generators: [
        {
          key: 'admin:7',
          source_type: ActivationCodeSourceType.ADMIN,
          source_text: '管理端生成',
          source_id: 7,
          generator_user: 'admin-seven',
          total: 6,
          pending: 2,
          used: 3,
          invalid: 1,
        },
        {
          key: 'distributor:11',
          source_type: ActivationCodeSourceType.DISTRIBUTOR,
          source_text: '分销购买',
          source_id: 11,
          generator_user: '分销用户十一',
          total: 4,
          pending: 1,
          used: 3,
          invalid: 0,
        },
      ],
    });
    expect(groupedBuilder.setParameters).toHaveBeenCalledWith({
      pendingStatus: ActivationCodeStatus.PENDING,
      usedStatus: ActivationCodeStatus.USED,
      invalidStatus: ActivationCodeStatus.INVALID,
    });
    expect(groupedBuilder.select).toHaveBeenCalledWith(expect.stringContaining('COALESCE(code.source_type'), 'source_type');
    expect(groupedBuilder.addGroupBy).toHaveBeenCalledWith('COALESCE(code.source_id, code.agent_id, 0)');
  });
});
