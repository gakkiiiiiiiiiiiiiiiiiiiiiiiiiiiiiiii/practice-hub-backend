import { CourseService } from './course.service';
import { CourseFileService } from './course-file.service';

describe('purchased paper material prices', () => {
  const makeService = () => {
    const service = Object.create(CourseService.prototype) as CourseService;
    const getAllCourses = jest.fn().mockResolvedValue([
      { id: 1, name: '已购', content_type: 'file', price: 20, hasAuth: true },
      { id: 2, name: '待核算', content_type: 'file', price: 20, hasAuth: true },
      { id: 3, name: '未购', content_type: 'file', price: 20, hasAuth: false },
      { id: 4, name: '免费', content_type: 'file', price: 0, hasAuth: true },
      { id: 5, name: '免费标记', content_type: 'file', price: 10, is_free: 1, hasAuth: true },
      { id: 6, name: '题库', content_type: 'normal', price: 20, hasAuth: true },
    ]);
    const listPricingFilesByCourseIds = jest.fn().mockResolvedValue([
      { id: 11, course_id: 1, file_type: 'pdf', file_page_count: 100 },
      { id: 12, course_id: 1, file_type: 'pdf', file_page_count: 20 },
      { id: 21, course_id: 2, file_type: 'pdf', file_page_count: null },
    ]);
    Object.assign(service, { getAllCourses, courseFileService: { listPricingFilesByCourseIds } });
    return { service, getAllCourses, listPricingFilesByCourseIds };
  };

  it('returns only paid accessible file courses and prices their active files in one batch', async () => {
    const h = makeService();
    const rows = await h.service.getPurchasedPaperMaterials(7);
    expect(h.getAllCourses).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, 7);
    expect(h.listPricingFilesByCourseIds).toHaveBeenCalledTimes(1);
    expect(h.listPricingFilesByCourseIds).toHaveBeenCalledWith([1, 2]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 1, paper_material: { available: true, total_pages: 120, price: 19 } });
    expect(rows[1]).toMatchObject({ id: 2, paper_material: { available: false, price: null } });
    expect(rows[1].paper_material.pending_reason).toBeTruthy();
    expect(rows[0]).not.toHaveProperty('file_url');
  });

  it('has an empty result for users with no purchased materials', async () => {
    const h = makeService();
    h.getAllCourses.mockResolvedValue([]);
    expect(await h.service.getPurchasedPaperMaterials(7)).toEqual([]);
  });

  it('does not hide catalog failures behind a zero price or empty list', async () => {
    const h = makeService();
    h.listPricingFilesByCourseIds.mockRejectedValue(new Error('database unavailable'));
    await expect(h.service.getPurchasedPaperMaterials(7)).rejects.toThrow('database unavailable');
  });

  it('queries database pricing metadata without URLs and skips an empty batch', async () => {
    const service = Object.create(CourseFileService.prototype) as CourseFileService;
    const find = jest.fn().mockResolvedValue([]);
    Object.assign(service, { courseFileRepository: { find } });
    expect(await service.listPricingFilesByCourseIds([])).toEqual([]);
    expect(find).not.toHaveBeenCalled();
    await service.listPricingFilesByCourseIds([1, 2]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][0].where.status).toBe(1);
    expect(find.mock.calls[0][0].select).not.toContain('file_url');
  });
});
