import { SystemService } from './system.service';

describe('SystemService course default params', () => {
  const service = Object.create(SystemService.prototype) as SystemService;

  it('uses permanent validity for paid courses by default', () => {
    const defaults = (service as any).getDefaultCourseDefaultParams();
    const normalized = (service as any).normalizeCourseDefaultParams({ is_free: 0 });

    expect(defaults.validity_days).toBeNull();
    expect(normalized.validity_days).toBeNull();
  });

  it('preserves explicit permanent and finite validity values', () => {
    expect(
      (service as any).normalizeCourseDefaultParams({ is_free: 0, validity_days: null }).validity_days,
    ).toBeNull();
    expect(
      (service as any).normalizeCourseDefaultParams({ is_free: 0, validity_days: 365 }).validity_days,
    ).toBe(365);
  });
});
