import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AppUser, AppUserRole } from "../../database/entities/app-user.entity";
import { Course } from "../../database/entities/course.entity";
import { CourseCategory } from "../../database/entities/course-category.entity";
import { Distributor } from "../../database/entities/distributor.entity";
import { PackageSection } from "../../database/entities/package-section.entity";
import { SystemConfig } from "../../database/entities/system-config.entity";
import { UpdateAgentPriceExclusionsDto } from "./dto/update-agent-price-exclusions.dto";
import {
  ApplyAgentPriceTemplatesDto,
  UpdateAgentPriceTemplatesDto,
} from "./dto/update-agent-price-templates.dto";

type AgentPriceExclusionConfig = {
  category_ids: number[];
  package_section_ids: number[];
};

type AgentPriceTemplate = {
  level: number;
  discount: number;
  enabled: boolean;
};

type AgentPriceTemplateConfig = {
  templates: AgentPriceTemplate[];
};

type ResolvedAgentPriceExclusions = {
  config: AgentPriceExclusionConfig;
  categories: CourseCategory[];
  categoryParents: Map<number, CourseCategory>;
  packageSections: PackageSection[];
};

const AGENT_PRICE_EXCLUSIONS_CONFIG_KEY = "agent_price_exclusions";
const AGENT_PRICE_TEMPLATES_CONFIG_KEY = "agent_price_templates";
const EMPTY_CONFIG: AgentPriceExclusionConfig = {
  category_ids: [],
  package_section_ids: [],
};
const DEFAULT_AGENT_PRICE_TEMPLATES: AgentPriceTemplate[] = [
  { level: 1, discount: 4, enabled: true },
  { level: 2, discount: 3, enabled: true },
  { level: 3, discount: 2, enabled: true },
];

@Injectable()
export class AgentPricePolicyService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
    @InjectRepository(CourseCategory)
    private readonly courseCategoryRepository: Repository<CourseCategory>,
    @InjectRepository(PackageSection)
    private readonly packageSectionRepository: Repository<PackageSection>,
    @InjectRepository(Course)
    private readonly courseRepository: Repository<Course>,
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
    @InjectRepository(Distributor)
    private readonly distributorRepository: Repository<Distributor>,
  ) {}

  async getPolicyForUser(userId: number) {
    await this.assertAgentOrAdmin(userId);
    return this.buildPolicyResponse();
  }

  async updatePolicy(userId: number, dto: UpdateAgentPriceExclusionsDto) {
    await this.assertAppAdmin(userId);
    const config = this.normalizeConfig(dto);
    await this.assertTargetsExist(config);
    await this.saveExclusionConfig(config);
    return this.buildPolicyResponse();
  }

  async getAdminTemplateConfig() {
    const [templateConfig, policy] = await Promise.all([
      this.getTemplateConfig(),
      this.buildPolicyResponse(),
    ]);
    return {
      templates: templateConfig.templates,
      ...policy,
    };
  }

  async updateAdminTemplateConfig(dto: UpdateAgentPriceTemplatesDto) {
    const templateConfig = this.normalizeTemplateConfig(dto);
    const exclusionConfig = this.normalizeConfig(dto);
    await this.assertTargetsExist(exclusionConfig);
    await Promise.all([
      this.saveTemplateConfig(templateConfig),
      this.saveExclusionConfig(exclusionConfig),
    ]);
    return this.getAdminTemplateConfig();
  }

  async applyAdminTemplateConfig(dto: ApplyAgentPriceTemplatesDto) {
    const [templateConfig, resolved] = await Promise.all([
      this.getTemplateConfig(),
      this.resolveExclusions(),
    ]);
    const selectedTemplates = templateConfig.templates.filter(
      (template) =>
        template.enabled &&
        (!dto.agent_level || template.level === Number(dto.agent_level)),
    );
    if (selectedTemplates.length === 0) {
      throw new BadRequestException(
        dto.agent_level ? "指定等级模板未启用" : "请至少启用一个代理模板",
      );
    }

    const courses = await this.courseRepository.find();
    const eligibleCourses = courses.filter(
      (course) => !this.matchesResolvedPolicy(course, resolved),
    );
    for (const course of eligibleCourses) {
      const normalPrice = Number(course.price || 0);
      const prices = { ...(course.agent_prices || {}) };
      for (const template of selectedTemplates) {
        const agentPrice =
          normalPrice > 0
            ? Math.ceil((normalPrice * template.discount) / 10)
            : 0;
        prices[String(template.level)] = agentPrice;
        if (template.level === 1) course.agent_price = agentPrice;
      }
      course.agent_prices = prices;
    }
    if (eligibleCourses.length > 0) {
      await this.courseRepository.save(eligibleCourses, { chunk: 500 });
    }

    return {
      updated_course_count: eligibleCourses.length,
      excluded_course_count: courses.length - eligibleCourses.length,
      applied_levels: selectedTemplates.map((template) => template.level),
    };
  }

  async getCoursePrice(course: Course, agentLevel: number) {
    const excluded = await this.isCourseExcluded(course);
    const levelPrice = Number(course.agent_prices?.[String(agentLevel)] || 0);
    const configuredAgentPrice =
      levelPrice || Number(course.agent_price || course.price || 0);
    return {
      unitPrice: excluded ? Number(course.price || 0) : configuredAgentPrice,
      excluded,
      pricingMode: excluded ? "original" : "agent",
    };
  }

  async isCourseExcluded(course: Course) {
    const resolved = await this.resolveExclusions();
    return this.matchesResolvedPolicy(course, resolved);
  }

  private async buildPolicyResponse() {
    const resolved = await this.resolveExclusions();
    const courses = await this.courseRepository.find({
      select: ["id", "category", "sub_category"],
    });
    const excludedCourseIds = courses
      .filter((course) => this.matchesResolvedPolicy(course, resolved))
      .map((course) => Number(course.id));

    return {
      ...resolved.config,
      excluded_course_ids: excludedCourseIds,
      excluded_course_count: excludedCourseIds.length,
      categories: resolved.categories.map((category) => ({
        id: category.id,
        name: category.name,
        parent_id: category.parent_id,
        parent_name: category.parent_id
          ? resolved.categoryParents.get(category.parent_id)?.name || ""
          : "",
      })),
      packages: resolved.packageSections.map((section) => ({
        id: section.id,
        name: section.name,
      })),
    };
  }

  private async resolveExclusions(): Promise<ResolvedAgentPriceExclusions> {
    const config = await this.getConfig();
    const categories = config.category_ids.length
      ? await this.courseCategoryRepository.find({
          where: { id: In(config.category_ids) },
        })
      : [];
    const parentIds = Array.from(
      new Set(
        categories
          .map((category) => Number(category.parent_id))
          .filter((id) => id > 0),
      ),
    );
    const parents = parentIds.length
      ? await this.courseCategoryRepository.find({
          where: { id: In(parentIds) },
        })
      : [];
    const packageSections = config.package_section_ids.length
      ? await this.packageSectionRepository.find({
          where: { id: In(config.package_section_ids) },
        })
      : [];

    return {
      config,
      categories,
      categoryParents: new Map(
        parents.map((category) => [category.id, category]),
      ),
      packageSections,
    };
  }

  private matchesResolvedPolicy(
    course: Course,
    resolved: ResolvedAgentPriceExclusions,
  ) {
    // 套餐/VIP 是独立商品。排除套餐只表示套餐商品本身不享代理价，
    // 不能把套餐覆盖的课程（尤其是 scope=all 的 VIP）连带判定为原价。
    return resolved.categories.some((category) =>
      this.courseMatchesCategory(course, category, resolved.categoryParents),
    );
  }

  private courseMatchesCategory(
    course: Course,
    category: CourseCategory,
    parents: Map<number, CourseCategory>,
  ) {
    const courseCategory = String(course.category || "").trim();
    const courseSubCategory = String(course.sub_category || "").trim();
    if (!category.parent_id)
      return courseCategory === String(category.name || "").trim();
    const parentName = String(
      parents.get(category.parent_id)?.name || "",
    ).trim();
    return (
      courseCategory === parentName &&
      courseSubCategory === String(category.name || "").trim()
    );
  }

  private async getConfig(): Promise<AgentPriceExclusionConfig> {
    const stored = await this.systemConfigRepository.findOne({
      where: { configKey: AGENT_PRICE_EXCLUSIONS_CONFIG_KEY },
    });
    if (!stored?.configValue) return { ...EMPTY_CONFIG };
    try {
      return this.normalizeConfig(JSON.parse(stored.configValue));
    } catch {
      return { ...EMPTY_CONFIG };
    }
  }

  private async getTemplateConfig(): Promise<AgentPriceTemplateConfig> {
    const stored = await this.systemConfigRepository.findOne({
      where: { configKey: AGENT_PRICE_TEMPLATES_CONFIG_KEY },
    });
    if (!stored?.configValue)
      return {
        templates: DEFAULT_AGENT_PRICE_TEMPLATES.map((item) => ({ ...item })),
      };
    try {
      return this.normalizeTemplateConfig(JSON.parse(stored.configValue));
    } catch {
      return {
        templates: DEFAULT_AGENT_PRICE_TEMPLATES.map((item) => ({ ...item })),
      };
    }
  }

  private normalizeTemplateConfig(
    value: Partial<AgentPriceTemplateConfig>,
  ): AgentPriceTemplateConfig {
    const byLevel = new Map<number, AgentPriceTemplate>();
    for (const item of Array.isArray(value?.templates) ? value.templates : []) {
      const level = Number(item?.level);
      const discount = Number(item?.discount);
      if (
        !Number.isInteger(level) ||
        level < 1 ||
        level > 3 ||
        !Number.isFinite(discount)
      )
        continue;
      byLevel.set(level, {
        level,
        discount: Math.min(10, Math.max(0.1, Math.round(discount * 10) / 10)),
        enabled: item?.enabled !== false,
      });
    }
    return {
      templates: DEFAULT_AGENT_PRICE_TEMPLATES.map(
        (fallback) => byLevel.get(fallback.level) || { ...fallback },
      ),
    };
  }

  private async saveTemplateConfig(config: AgentPriceTemplateConfig) {
    let stored = await this.systemConfigRepository.findOne({
      where: { configKey: AGENT_PRICE_TEMPLATES_CONFIG_KEY },
    });
    if (!stored) {
      stored = this.systemConfigRepository.create({
        configKey: AGENT_PRICE_TEMPLATES_CONFIG_KEY,
        configValue: JSON.stringify(config),
        description: "各级代理商价格模板",
      });
    } else {
      stored.configValue = JSON.stringify(config);
      stored.description = "各级代理商价格模板";
    }
    await this.systemConfigRepository.save(stored);
  }

  private async saveExclusionConfig(config: AgentPriceExclusionConfig) {
    let stored = await this.systemConfigRepository.findOne({
      where: { configKey: AGENT_PRICE_EXCLUSIONS_CONFIG_KEY },
    });
    if (!stored) {
      stored = this.systemConfigRepository.create({
        configKey: AGENT_PRICE_EXCLUSIONS_CONFIG_KEY,
        configValue: JSON.stringify(config),
        description: "代理商价格排除的课程分类与套餐商品",
      });
    } else {
      stored.configValue = JSON.stringify(config);
      stored.description = "代理商价格排除的课程分类与套餐商品";
    }
    await this.systemConfigRepository.save(stored);
  }

  private normalizeConfig(
    value: Partial<AgentPriceExclusionConfig>,
  ): AgentPriceExclusionConfig {
    const normalizeIds = (ids: unknown) =>
      Array.from(
        new Set(
          (Array.isArray(ids) ? ids : [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ).sort((a, b) => a - b);
    return {
      category_ids: normalizeIds(value?.category_ids),
      package_section_ids: normalizeIds(value?.package_section_ids),
    };
  }

  private async assertTargetsExist(config: AgentPriceExclusionConfig) {
    const [categoryCount, packageCount] = await Promise.all([
      config.category_ids.length
        ? this.courseCategoryRepository.count({
            where: { id: In(config.category_ids) },
          })
        : 0,
      config.package_section_ids.length
        ? this.packageSectionRepository.count({
            where: { id: In(config.package_section_ids) },
          })
        : 0,
    ]);
    if (categoryCount !== config.category_ids.length)
      throw new BadRequestException("部分排除分类不存在");
    if (packageCount !== config.package_section_ids.length)
      throw new BadRequestException("部分排除套餐不存在");
  }

  private async assertAppAdmin(userId: number) {
    const user = await this.appUserRepository.findOne({
      where: { id: userId },
    });
    if (user?.role !== AppUserRole.ADMIN)
      throw new BadRequestException("仅小程序超级管理员可以设置代理价排除范围");
  }

  private async assertAgentOrAdmin(userId: number) {
    const [user, distributor] = await Promise.all([
      this.appUserRepository.findOne({ where: { id: userId } }),
      this.distributorRepository.findOne({ where: { user_id: userId } }),
    ]);
    if (user?.role !== AppUserRole.ADMIN && distributor?.status !== 1) {
      throw new BadRequestException("仅代理商或小程序管理员可以查看代理价规则");
    }
  }
}
