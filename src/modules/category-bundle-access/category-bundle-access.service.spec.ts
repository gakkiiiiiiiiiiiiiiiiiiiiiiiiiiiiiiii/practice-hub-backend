import { CategoryBundleAccessService } from './category-bundle-access.service';

describe('CategoryBundleAccessService', () => {
  const createService = (accesses: any[], categories: any[]) => {
    const accessRepository = {
      find: jest.fn().mockResolvedValue(accesses),
      count: jest.fn().mockResolvedValue(accesses.length),
      create: jest.fn((value) => value),
      upsert: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const categoryRepository = {
      find: jest.fn(async ({ where }: any) => {
        const ids = where.id?._value || where.id;
        return categories.filter((category) => ids.includes(category.id));
      }),
    };
    return {
      service: new CategoryBundleAccessService(accessRepository as any, categoryRepository as any),
      accessRepository,
    };
  };

  it('automatically grants a newly-added course in a purchased secondary category', async () => {
    const { service } = createService(
      [{ user_id: 7, category_id: 12, order_id: 99 }],
      [
        { id: 1, name: '历史学', parent_id: null },
        { id: 12, name: '考研专业课', parent_id: 1 },
      ],
    );

    const course = { id: 501, category: '历史学', sub_category: '考研专业课' } as any;
    await expect(service.userHasCourseAccess(7, course)).resolves.toBe(true);
  });

  it('grants all subcategories when the purchased category is a primary category', async () => {
    const { service } = createService(
      [{ user_id: 7, category_id: 1, order_id: 99 }],
      [{ id: 1, name: '历史学', parent_id: null }],
    );

    const accessMap = await service.batchUserHasCourseAccess(7, [
      { id: 501, category: '历史学', sub_category: '笔记' } as any,
      { id: 502, category: '历史学', sub_category: '真题' } as any,
      { id: 503, category: '政治学', sub_category: '笔记' } as any,
    ]);

    expect([...accessMap.keys()]).toEqual([501, 502]);
  });

  it('grants once per order and supports revoking that order', async () => {
    const { service, accessRepository } = createService([], []);
    const order = {
      id: 99,
      order_no: 'CATEGORY99',
      user_id: 7,
      pay_payload: { category_bundle: { category_id: 12 } },
    } as any;

    await service.grantOrderAccess(order);
    await service.revokeOrderAccess(order.id);

    expect(accessRepository.upsert).toHaveBeenCalledWith(
      { user_id: 7, category_id: 12, order_id: 99 },
      ['order_id'],
    );
    expect(accessRepository.delete).toHaveBeenCalledWith({ order_id: 99 });
  });
});
