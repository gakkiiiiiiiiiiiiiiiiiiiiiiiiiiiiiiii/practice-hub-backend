import { BadRequestException } from "@nestjs/common";
import { AppUserRole } from "../../database/entities/app-user.entity";
import { AgentPricePolicyService } from "./agent-price-policy.service";

describe("AgentPricePolicyService", () => {
  const createService = (config: any = null) => {
    const storedConfigs = new Map<string, any>();
    if (config) storedConfigs.set("agent_price_exclusions", config);
    const systemConfigRepository = {
      findOne: jest.fn(({ where }: any) => {
        const value = storedConfigs.get(where.configKey);
        return Promise.resolve(
          value
            ? {
                id: 1,
                configKey: where.configKey,
                configValue: JSON.stringify(value),
              }
            : null,
        );
      }),
      create: jest.fn((value) => value),
      save: jest.fn((value) => {
        storedConfigs.set(value.configKey, JSON.parse(value.configValue));
        return Promise.resolve(value);
      }),
    };
    const courseCategoryRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const packageSectionRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const courseRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    const appUserRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 1, role: AppUserRole.ADMIN }),
    };
    const distributorRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const service = new AgentPricePolicyService(
      systemConfigRepository as any,
      courseCategoryRepository as any,
      packageSectionRepository as any,
      courseRepository as any,
      appUserRepository as any,
      distributorRepository as any,
    );
    return {
      service,
      systemConfigRepository,
      courseCategoryRepository,
      packageSectionRepository,
      courseRepository,
      appUserRepository,
    };
  };

  it("uses the configured level price when the course is not excluded", async () => {
    const { service } = createService();

    await expect(
      service.getCoursePrice(
        {
          id: 12,
          category: "护理",
          sub_category: "内科",
          price: 20,
          agent_price: 6,
          agent_prices: { "2": 4 },
        } as any,
        2,
      ),
    ).resolves.toEqual({ unitPrice: 4, excluded: false, pricingMode: "agent" });
  });

  it("uses the original price for a course in an excluded primary category", async () => {
    const { service, courseCategoryRepository } = createService({
      category_ids: [3],
      package_section_ids: [],
    });
    courseCategoryRepository.find.mockResolvedValue([
      { id: 3, name: "护理", parent_id: null },
    ]);

    await expect(
      service.getCoursePrice(
        {
          id: 12,
          category: "护理",
          sub_category: "内科",
          price: 20,
          agent_price: 6,
          agent_prices: { "3": 3 },
        } as any,
        3,
      ),
    ).resolves.toEqual({
      unitPrice: 20,
      excluded: true,
      pricingMode: "original",
    });
  });

  it("only excludes the matching child category", async () => {
    const { service, courseCategoryRepository } = createService({
      category_ids: [8],
      package_section_ids: [],
    });
    courseCategoryRepository.find
      .mockResolvedValueOnce([{ id: 8, name: "内科", parent_id: 3 }])
      .mockResolvedValueOnce([{ id: 3, name: "护理", parent_id: null }]);

    await expect(
      service.getCoursePrice(
        {
          id: 13,
          category: "护理",
          sub_category: "外科",
          price: 20,
          agent_price: 6,
        } as any,
        1,
      ),
    ).resolves.toMatchObject({ unitPrice: 6, excluded: false });
  });

  it("does not exclude courses covered by an excluded package or all-site VIP", async () => {
    const { service, packageSectionRepository } = createService({
      category_ids: [],
      package_section_ids: [5],
    });
    packageSectionRepository.find.mockResolvedValue([
      { id: 5, name: "尊享VIP会员" },
    ]);

    await expect(
      service.getCoursePrice(
        {
          id: 12,
          category: "护理",
          sub_category: "内科",
          price: 20,
          agent_price: 6,
        } as any,
        1,
      ),
    ).resolves.toMatchObject({
      unitPrice: 6,
      excluded: false,
      pricingMode: "agent",
    });
  });

  it("normalizes duplicate ids when an admin updates the policy", async () => {
    const {
      service,
      courseCategoryRepository,
      packageSectionRepository,
      systemConfigRepository,
    } = createService();
    courseCategoryRepository.count.mockResolvedValue(1);
    packageSectionRepository.count.mockResolvedValue(1);

    await service.updatePolicy(1, {
      category_ids: [3, 3],
      package_section_ids: [5, 5],
    });

    expect(systemConfigRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        configValue: JSON.stringify({
          category_ids: [3],
          package_section_ids: [5],
        }),
      }),
    );
  });

  it("rejects policy updates from a non-admin user", async () => {
    const { service, appUserRepository } = createService();
    appUserRepository.findOne.mockResolvedValue({
      id: 9,
      role: AppUserRole.USER,
    });

    await expect(
      service.updatePolicy(9, {
        category_ids: [3, 3],
        package_section_ids: [5],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns the default three-level agent price templates", async () => {
    const { service } = createService();

    await expect(service.getAdminTemplateConfig()).resolves.toMatchObject({
      templates: [
        { level: 1, discount: 4, enabled: true },
        { level: 2, discount: 3, enabled: true },
        { level: 3, discount: 2, enabled: true },
      ],
      category_ids: [],
      package_section_ids: [],
    });
  });

  it("saves template discounts together with the shared exclusion policy", async () => {
    const {
      service,
      courseCategoryRepository,
      packageSectionRepository,
      systemConfigRepository,
    } = createService();
    courseCategoryRepository.count.mockResolvedValue(1);
    packageSectionRepository.count.mockResolvedValue(1);

    await service.updateAdminTemplateConfig({
      templates: [
        { level: 1, discount: 4, enabled: true },
        { level: 2, discount: 3.5, enabled: true },
        { level: 3, discount: 2, enabled: false },
      ],
      category_ids: [3],
      package_section_ids: [5],
    });

    expect(systemConfigRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ configKey: "agent_price_templates" }),
    );
    expect(systemConfigRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ configKey: "agent_price_exclusions" }),
    );
  });

  it("applies enabled templates to eligible courses and skips excluded categories", async () => {
    const { service, courseRepository, courseCategoryRepository } =
      createService({
        category_ids: [3],
        package_section_ids: [],
      });
    courseCategoryRepository.find.mockResolvedValue([
      { id: 3, name: "考研真题", parent_id: null },
    ]);
    courseRepository.find.mockResolvedValue([
      { id: 1, category: "护理", price: 5, agent_price: 0, agent_prices: null },
      {
        id: 2,
        category: "考研真题",
        price: 5,
        agent_price: 0,
        agent_prices: null,
      },
    ]);

    await expect(service.applyAdminTemplateConfig({})).resolves.toEqual({
      updated_course_count: 1,
      excluded_course_count: 1,
      applied_levels: [1, 2, 3],
    });
    expect(courseRepository.save).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 1,
          agent_price: 2,
          agent_prices: { "1": 2, "2": 2, "3": 1 },
        }),
      ],
      { chunk: 500 },
    );
  });
});
