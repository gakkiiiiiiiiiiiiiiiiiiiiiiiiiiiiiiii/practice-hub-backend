import {
  getPackageSubCategoryScopeSql,
  requestCoursePreviewDemand,
  requestUserPreviewDemand,
} from './preview-demand.util';

describe('requestUserPreviewDemand', () => {
  it('queues only files from the requested course', async () => {
    const manager = { query: jest.fn().mockResolvedValue({ affectedRows: 2 }) };

    await expect(requestCoursePreviewDemand(manager as any, 447)).resolves.toBe(2);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('WHERE course_id = ?'), [447]);
    expect(manager.query.mock.calls[0][0]).not.toContain('user_course_auth');
  });

  it('ignores invalid course ids without querying the database', async () => {
    const manager = { query: jest.fn() };

    await expect(requestCoursePreviewDemand(manager as any, 0)).resolves.toBe(0);
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('queues only current user entitlements', async () => {
    const manager = { query: jest.fn().mockResolvedValue({ affectedRows: 7 }) };

    await expect(requestUserPreviewDemand(manager as any, 42)).resolves.toBe(7);
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0][0]).toContain('cf.full_preview_requested = 0');
    expect(manager.query.mock.calls[0][0]).toContain("JSON_EXTRACT(pss.scope_value, '$[0]')");
    expect(manager.query.mock.calls[0][0]).toContain("JSON_EXTRACT(pss.scope_value, '$[1]')");
    expect(manager.query.mock.calls[0][1]).toEqual([42, 42, 42]);
  });

  it('ignores invalid users without querying the database', async () => {
    const manager = { query: jest.fn() };

    await expect(requestUserPreviewDemand(manager as any, 0)).resolves.toBe(0);
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('matches JSON category paths while preserving legacy scope values', () => {
    const sql = getPackageSubCategoryScopeSql('course');

    expect(sql).toContain('JSON_VALID(pss.scope_value) = 1');
    expect(sql).toContain("COALESCE(course.category, '')");
    expect(sql).toContain("COALESCE(course.sub_category, '')");
    expect(sql).toContain('JSON_VALID(pss.scope_value) = 0');
  });
});
