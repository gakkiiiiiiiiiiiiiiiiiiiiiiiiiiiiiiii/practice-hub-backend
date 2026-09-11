import { CourseService } from './course.service';

describe('purchased courses', () => {
  const createService = ({ auths = [], courses = [], hasPackage = false, hasCategory = false } = {}) => {
    const service = Object.create(CourseService.prototype) as CourseService;
    const courseRepository = { find: jest.fn().mockResolvedValue(courses) };
    Object.assign(service, {
      courseRepository,
      userCourseAuthRepository: { find: jest.fn().mockResolvedValue(auths) },
      packageService: { hasAnyActiveSubscription: jest.fn().mockResolvedValue(hasPackage) },
      categoryBundleAccessService: { hasAnyUserAccess: jest.fn().mockResolvedValue(hasCategory) },
    });
    return { service, courseRepository };
  };

  it('returns directly authorized paid courses without scanning the catalogue', async () => {
    const { service, courseRepository } = createService({
      auths: [
        { course_id: 4, expire_time: null },
        { course_id: 5, expire_time: new Date(Date.now() + 60_000) },
        { course_id: 6, expire_time: new Date(Date.now() - 60_000) },
      ],
      courses: [
        { id: 5, name: '已购买 A', price: 20, is_free: 0, sort: 10 },
        { id: 4, name: '已购买 B', price: 20, is_free: 0, sort: 20 },
      ],
    });
    const getAllCourses = jest.fn();
    Object.assign(service, { getAllCourses });

    await expect(service.getPurchasedCourses(7)).resolves.toEqual([
      expect.objectContaining({ id: 5, hasAuth: true }),
      expect.objectContaining({ id: 4, hasAuth: true, expireTime: null }),
    ]);
    expect(courseRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { sort: 'ASC', id: 'ASC' } }),
    );
    expect(getAllCourses).not.toHaveBeenCalled();
  });

  it('returns immediately when a user has no course grants', async () => {
    const { service, courseRepository } = createService();
    const getAllCourses = jest.fn();
    Object.assign(service, { getAllCourses });

    await expect(service.getPurchasedCourses(7)).resolves.toEqual([]);
    expect(courseRepository.find).not.toHaveBeenCalled();
    expect(getAllCourses).not.toHaveBeenCalled();
  });

  it('preserves complete scope calculation for package users', async () => {
    const { service } = createService({ hasPackage: true });
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
