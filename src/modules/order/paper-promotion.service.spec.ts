import {
  DEFAULT_PAPER_PROMOTION_CONFIG,
  PaperPromotionService,
} from "./paper-promotion.service";

describe("PaperPromotionService", () => {
  const createService = (configValue?: string) => {
    const row =
      configValue === undefined
        ? null
        : { configKey: "paper_material_promotion", configValue };
    const repository = {
      findOne: jest.fn().mockResolvedValue(row),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => value),
    };
    return {
      service: new PaperPromotionService(repository as any),
      repository,
    };
  };

  it("uses the requested default sequence: two kinds save one yuan, three save two", async () => {
    const { service } = createService();

    await expect(service.calculateDiscount(1, 50)).resolves.toMatchObject({
      discountAmount: 0,
    });
    await expect(service.calculateDiscount(2, 50)).resolves.toMatchObject({
      discountAmount: 1,
    });
    await expect(service.calculateDiscount(3, 50)).resolves.toMatchObject({
      discountAmount: 2,
    });
  });

  it("honors persisted configuration and can disable the promotion", async () => {
    const { service } = createService(
      JSON.stringify({
        enabled: true,
        minimum_items: 3,
        discount_per_additional_item: 2,
      }),
    );
    await expect(service.calculateDiscount(2, 50)).resolves.toMatchObject({
      discountAmount: 0,
    });
    await expect(service.calculateDiscount(3, 50)).resolves.toMatchObject({
      discountAmount: 2,
    });
    await expect(service.calculateDiscount(4, 50)).resolves.toMatchObject({
      discountAmount: 4,
    });

    const disabled = createService(
      JSON.stringify({ ...DEFAULT_PAPER_PROMOTION_CONFIG, enabled: false }),
    ).service;
    await expect(disabled.calculateDiscount(20, 50)).resolves.toMatchObject({
      discountAmount: 0,
    });
  });

  it("keeps at least one cent payable when configuration exceeds the material amount", async () => {
    const { service } = createService(
      JSON.stringify({
        enabled: true,
        minimum_items: 2,
        discount_per_additional_item: 100,
      }),
    );
    await expect(service.calculateDiscount(2, 12)).resolves.toMatchObject({
      discountAmount: 11.99,
    });
  });

  it("persists a normalized admin configuration", async () => {
    const { service, repository } = createService();
    await expect(
      service.setConfig({
        enabled: false,
        minimum_items: 4,
        discount_per_additional_item: 3,
      }),
    ).resolves.toEqual({
      enabled: false,
      minimum_items: 4,
      discount_per_additional_item: 3,
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        configValue: JSON.stringify({
          enabled: false,
          minimum_items: 4,
          discount_per_additional_item: 3,
        }),
      }),
    );
  });
});
