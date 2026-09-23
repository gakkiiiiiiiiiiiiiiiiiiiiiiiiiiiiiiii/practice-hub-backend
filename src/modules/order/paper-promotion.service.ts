import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SystemConfig } from "../../database/entities/system-config.entity";
import { SetPaperPromotionDto } from "./dto/set-paper-promotion.dto";

export const PAPER_PROMOTION_CONFIG_KEY = "paper_material_promotion";

export type PaperPromotionConfig = {
  enabled: boolean;
  minimum_items: number;
  discount_per_additional_item: number;
};

export const DEFAULT_PAPER_PROMOTION_CONFIG: PaperPromotionConfig = {
  enabled: true,
  minimum_items: 2,
  discount_per_additional_item: 1,
};

@Injectable()
export class PaperPromotionService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
  ) {}

  private normalizeConfig(
    value: Partial<PaperPromotionConfig> | null | undefined,
  ): PaperPromotionConfig {
    const minimumItems = Number(value?.minimum_items);
    const discountPerItem = Number(value?.discount_per_additional_item);
    return {
      enabled:
        typeof value?.enabled === "boolean"
          ? value.enabled
          : DEFAULT_PAPER_PROMOTION_CONFIG.enabled,
      minimum_items:
        Number.isInteger(minimumItems) &&
        minimumItems >= 2 &&
        minimumItems <= 20
          ? minimumItems
          : DEFAULT_PAPER_PROMOTION_CONFIG.minimum_items,
      discount_per_additional_item:
        Number.isInteger(discountPerItem) &&
        discountPerItem >= 1 &&
        discountPerItem <= 100
          ? discountPerItem
          : DEFAULT_PAPER_PROMOTION_CONFIG.discount_per_additional_item,
    };
  }

  async getConfig(): Promise<PaperPromotionConfig> {
    const row = await this.systemConfigRepository.findOne({
      where: { configKey: PAPER_PROMOTION_CONFIG_KEY },
    });
    if (!row?.configValue) return { ...DEFAULT_PAPER_PROMOTION_CONFIG };
    try {
      return this.normalizeConfig(JSON.parse(row.configValue));
    } catch {
      return { ...DEFAULT_PAPER_PROMOTION_CONFIG };
    }
  }

  async setConfig(dto: SetPaperPromotionDto): Promise<PaperPromotionConfig> {
    const value = this.normalizeConfig(dto);
    let row = await this.systemConfigRepository.findOne({
      where: { configKey: PAPER_PROMOTION_CONFIG_KEY },
    });
    if (!row) {
      row = this.systemConfigRepository.create({
        configKey: PAPER_PROMOTION_CONFIG_KEY,
        configValue: JSON.stringify(value),
        description: "纸质资料合单促销配置",
      });
    } else {
      row.configValue = JSON.stringify(value);
      row.description = "纸质资料合单促销配置";
      row.updateTime = new Date();
    }
    await this.systemConfigRepository.save(row);
    return value;
  }

  async calculateDiscount(itemCount: number, materialAmount: number) {
    const config = await this.getConfig();
    const safeItemCount = Number.isInteger(itemCount)
      ? Math.max(0, itemCount)
      : 0;
    const materialAmountCents = Math.max(
      0,
      Math.round(Number(materialAmount || 0) * 100),
    );
    const steps = config.enabled
      ? Math.max(0, safeItemCount - config.minimum_items + 1)
      : 0;
    const requestedDiscountCents =
      steps * config.discount_per_additional_item * 100;
    const discountCents = Math.min(
      requestedDiscountCents,
      Math.max(0, materialAmountCents - 1),
    );
    return {
      config,
      itemCount: safeItemCount,
      discountAmount: discountCents / 100,
    };
  }
}
