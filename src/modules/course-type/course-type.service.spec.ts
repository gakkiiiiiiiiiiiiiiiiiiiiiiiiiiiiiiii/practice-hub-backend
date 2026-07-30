import { CourseTypeService } from './course-type.service';

describe('CourseTypeService category visibility', () => {
  const types = [
    { id: 1, name: '通用', category_ids: null, status: 1, sort: 0 },
    { id: 2, name: '一级分类专属', category_ids: [10], status: 1, sort: 1 },
    { id: 3, name: '二级分类专属', category_ids: [11], status: 1, sort: 2 },
    { id: 4, name: '其他分类', category_ids: [99], status: 1, sort: 3 },
  ];

  const createService = (category: any) =>
    new CourseTypeService(
      { find: jest.fn().mockResolvedValue(types) } as any,
      { findOne: jest.fn().mockResolvedValue(category) } as any,
    );

  it('shows unbound, parent-bound and child-bound types in a child category', async () => {
    const service = createService({ id: 11, parent_id: 10 });
    const result = await service.list({ onlyEnabled: true, filterByCategory: true, categoryId: 11 });
    expect(result.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('shows only unbound types when no category is selected', async () => {
    const service = createService(null);
    const result = await service.list({ onlyEnabled: true, filterByCategory: true });
    expect(result.map((item) => item.id)).toEqual([1]);
  });
});
