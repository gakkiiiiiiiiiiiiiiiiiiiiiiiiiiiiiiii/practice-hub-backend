import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { UserCheckin } from '../../database/entities/user-checkin.entity';

export type TitleTierStyle = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'king';

export type UserTitleTierConfig = {
  id: string;
  name: string;
  minDays: number;
  tierStyle: TitleTierStyle;
  textColor: string;
  sort: number;
  enabled?: boolean;
};

export type UserTitleConfig = {
  enabled: boolean;
  tiers: UserTitleTierConfig[];
};

export type ResolvedUserTitle = {
  id: string;
  name: string;
  tierStyle: TitleTierStyle;
  textColor: string;
  minDays: number;
  studyDays: number;
  nextTitle: {
    name: string;
    minDays: number;
    daysRemaining: number;
  } | null;
};

const TITLE_STYLE_SET = new Set<TitleTierStyle>(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'king']);

const DEFAULT_STYLE_TEXT_COLORS: Record<TitleTierStyle, string> = {
  bronze: '#5c3d2e',
  silver: '#3d4a5c',
  gold: '#6b4e16',
  platinum: '#0f4c5c',
  diamond: '#1e3a8a',
  king: '#4c1d95',
};

const DEFAULT_USER_TITLE_CONFIG: UserTitleConfig = {
  enabled: true,
  tiers: [
    { id: 'tier_1', name: '备考新兵', minDays: 0, tierStyle: 'bronze', textColor: '#5c3d2e', sort: 1, enabled: true },
    { id: 'tier_2', name: '筑基学士', minDays: 7, tierStyle: 'silver', textColor: '#3d4a5c', sort: 2, enabled: true },
    { id: 'tier_3', name: '刷题先锋', minDays: 30, tierStyle: 'gold', textColor: '#6b4e16', sort: 3, enabled: true },
    { id: 'tier_4', name: '真题宗师', minDays: 90, tierStyle: 'platinum', textColor: '#0f4c5c', sort: 4, enabled: true },
    { id: 'tier_5', name: '过线战神', minDays: 180, tierStyle: 'diamond', textColor: '#1e3a8a', sort: 5, enabled: true },
    { id: 'tier_6', name: '研途王者', minDays: 365, tierStyle: 'king', textColor: '#4c1d95', sort: 6, enabled: true },
  ],
};

@Injectable()
export class UserTitleService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
    @InjectRepository(UserCheckin)
    private readonly checkinRepository: Repository<UserCheckin>,
  ) {}

  async getConfig(): Promise<UserTitleConfig> {
    const config = await this.systemConfigRepository.findOne({
      where: { configKey: 'user_title_config' },
    });
    if (!config?.configValue) {
      return { ...DEFAULT_USER_TITLE_CONFIG, tiers: [...DEFAULT_USER_TITLE_CONFIG.tiers] };
    }
    try {
      const parsed = JSON.parse(config.configValue) as Partial<UserTitleConfig>;
      return this.normalizeConfig(parsed);
    } catch {
      return { ...DEFAULT_USER_TITLE_CONFIG, tiers: [...DEFAULT_USER_TITLE_CONFIG.tiers] };
    }
  }

  async setConfig(input: Partial<UserTitleConfig>): Promise<UserTitleConfig> {
    const current = await this.getConfig();
    const next = this.normalizeConfig({
      enabled: input.enabled ?? current.enabled,
      tiers: input.tiers ?? current.tiers,
    });

    let row = await this.systemConfigRepository.findOne({ where: { configKey: 'user_title_config' } });
    if (!row) {
      row = this.systemConfigRepository.create({
        configKey: 'user_title_config',
        configValue: JSON.stringify(next),
        description: '用户学习称号配置',
      });
    } else {
      row.configValue = JSON.stringify(next);
      row.description = row.description || '用户学习称号配置';
    }
    await this.systemConfigRepository.save(row);
    return next;
  }

  async countUserStudyDays(userId: number): Promise<number> {
    const raw = await this.checkinRepository
      .createQueryBuilder('checkin')
      .select('COUNT(DISTINCT checkin.checkin_date)', 'total')
      .where('checkin.user_id = :userId', { userId })
      .getRawOne<{ total?: string | number }>();
    return Math.max(0, Number(raw?.total) || 0);
  }

  async resolveUserTitle(userId: number): Promise<ResolvedUserTitle | null> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return null;
    }
    const studyDays = await this.countUserStudyDays(userId);
    const tiers = config.tiers.filter((tier) => tier.enabled !== false);
    if (!tiers.length) {
      return null;
    }

    let current = tiers[0];
    for (const tier of tiers) {
      if (studyDays >= tier.minDays) {
        current = tier;
      }
    }

    const currentIndex = tiers.findIndex((tier) => tier.id === current.id);
    const nextTier = currentIndex >= 0 && currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;

    return {
      id: current.id,
      name: current.name,
      tierStyle: current.tierStyle,
      textColor: current.textColor,
      minDays: current.minDays,
      studyDays,
      nextTitle: nextTier
        ? {
            name: nextTier.name,
            minDays: nextTier.minDays,
            daysRemaining: Math.max(0, nextTier.minDays - studyDays),
          }
        : null,
    };
  }

  private normalizeConfig(input: Partial<UserTitleConfig>): UserTitleConfig {
    const sourceTiers =
      Array.isArray(input.tiers) && input.tiers.length > 0 ? input.tiers : DEFAULT_USER_TITLE_CONFIG.tiers;
    const tiers = sourceTiers
      .map((tier, index) => {
        const minDays = Math.max(0, Math.floor(Number(tier.minDays) || 0));
        const tierStyle = TITLE_STYLE_SET.has(tier.tierStyle as TitleTierStyle)
          ? (tier.tierStyle as TitleTierStyle)
          : 'bronze';
        return {
          id: String(tier.id || `tier_${index + 1}`).trim(),
          name: String(tier.name || `称号${index + 1}`).trim(),
          minDays,
          tierStyle,
          textColor: this.normalizeTextColor(tier.textColor, tierStyle),
          sort: Math.max(0, Math.floor(Number(tier.sort) || index + 1)),
          enabled: tier.enabled !== false,
        };
      })
      .filter((tier) => tier.id && tier.name)
      .sort((a, b) => a.sort - b.sort || a.minDays - b.minDays);

    // 保证最低档从 0 天开始
    if (tiers.length > 0 && tiers[0].minDays > 0) {
      tiers[0].minDays = 0;
    }

    return {
      enabled: input.enabled !== false,
      tiers: tiers.length > 0 ? tiers : [...DEFAULT_USER_TITLE_CONFIG.tiers],
    };
  }

  private normalizeTextColor(raw: unknown, tierStyle: TitleTierStyle): string {
    const value = String(raw || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      return value.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      const hex = value.slice(1);
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
    }
    return DEFAULT_STYLE_TEXT_COLORS[tierStyle] || DEFAULT_STYLE_TEXT_COLORS.bronze;
  }
}
