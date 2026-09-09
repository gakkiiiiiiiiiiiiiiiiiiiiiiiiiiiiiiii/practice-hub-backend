import { CourseService } from './course.service';

describe('purchased courses', () => {
  it('returns only paid accessible courses in display order', async () => {
    const service = Object.create(CourseService.prototype) as CourseService;
    const getAllCourses = jest.fn().mockResolvedValue([
      { id: 1, name: '未购买', price: 20, hasAuth: false, sort: 1 },
      { id: 2, name: '免费课程', price: 0, hasAuth: true, sort: 2 },
      { id: 3, name: '免费标记', price: 20, is_free: 1, hasAuth: true, sort: 3 },
      { id: 4, name: '已购买 B', price: 20, hasAuth: true, sort: 20 },
      { id: 5, name: '已购买 A', price: 20, hasAuth: true, sort: 10 },
    ]);
    Object.assign(service, { getAllCourses });

    await expect(service.getPurchasedCourses(7)).resolves.toEqual([
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ id: 4 }),
    ]);
    expect(getAllCourses).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      7,
    );
  });
});
