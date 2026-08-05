import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';
import { Course } from '../../database/entities/course.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Distributor } from '../../database/entities/distributor.entity';
import { PackageScopeType } from '../../database/entities/package-section-scope.entity';
import { PackageSection } from '../../database/entities/package-section.entity';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { UpdateAgentPriceExclusionsDto } from './dto/update-agent-price-exclusions.dto';

type AgentPriceExclusionConfig = {
	category_ids: number[];
	package_section_ids: number[];
};

type ResolvedAgentPriceExclusions = {
	config: AgentPriceExclusionConfig;
	categories: CourseCategory[];
	categoryParents: Map<number, CourseCategory>;
	packageSections: PackageSection[];
};

const AGENT_PRICE_EXCLUSIONS_CONFIG_KEY = 'agent_price_exclusions';
const EMPTY_CONFIG: AgentPriceExclusionConfig = { category_ids: [], package_section_ids: [] };

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

		let stored = await this.systemConfigRepository.findOne({
			where: { configKey: AGENT_PRICE_EXCLUSIONS_CONFIG_KEY },
		});
		if (!stored) {
			stored = this.systemConfigRepository.create({
				configKey: AGENT_PRICE_EXCLUSIONS_CONFIG_KEY,
				configValue: JSON.stringify(config),
				description: '代理商价格排除的课程分类与套餐',
			});
		} else {
			stored.configValue = JSON.stringify(config);
			stored.description = '代理商价格排除的课程分类与套餐';
		}
		await this.systemConfigRepository.save(stored);
		return this.buildPolicyResponse();
	}

	async getCoursePrice(course: Course, agentLevel: number) {
		const excluded = await this.isCourseExcluded(course);
		const levelPrice = Number(course.agent_prices?.[String(agentLevel)] || 0);
		const configuredAgentPrice = levelPrice || Number(course.agent_price || course.price || 0);
		return {
			unitPrice: excluded ? Number(course.price || 0) : configuredAgentPrice,
			excluded,
			pricingMode: excluded ? 'original' : 'agent',
		};
	}

	async isCourseExcluded(course: Course) {
		const resolved = await this.resolveExclusions();
		return this.matchesResolvedPolicy(course, resolved);
	}

	private async buildPolicyResponse() {
		const resolved = await this.resolveExclusions();
		const courses = await this.courseRepository.find({
			select: ['id', 'category', 'sub_category'],
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
				parent_name: category.parent_id ? resolved.categoryParents.get(category.parent_id)?.name || '' : '',
			})),
			packages: resolved.packageSections.map((section) => ({ id: section.id, name: section.name })),
		};
	}

	private async resolveExclusions(): Promise<ResolvedAgentPriceExclusions> {
		const config = await this.getConfig();
		const categories = config.category_ids.length
			? await this.courseCategoryRepository.find({ where: { id: In(config.category_ids) } })
			: [];
		const parentIds = Array.from(
			new Set(categories.map((category) => Number(category.parent_id)).filter((id) => id > 0)),
		);
		const parents = parentIds.length
			? await this.courseCategoryRepository.find({ where: { id: In(parentIds) } })
			: [];
		const packageSections = config.package_section_ids.length
			? await this.packageSectionRepository.find({
					where: { id: In(config.package_section_ids) },
					relations: ['scopes'],
				})
			: [];

		return {
			config,
			categories,
			categoryParents: new Map(parents.map((category) => [category.id, category])),
			packageSections,
		};
	}

	private matchesResolvedPolicy(course: Course, resolved: ResolvedAgentPriceExclusions) {
		if (resolved.categories.some((category) => this.courseMatchesCategory(course, category, resolved.categoryParents))) {
			return true;
		}
		return resolved.packageSections.some((section) =>
			(section.scopes || []).some((scope) => this.courseMatchesPackageScope(course, scope.scope_type, scope.scope_value)),
		);
	}

	private courseMatchesCategory(
		course: Course,
		category: CourseCategory,
		parents: Map<number, CourseCategory>,
	) {
		const courseCategory = String(course.category || '').trim();
		const courseSubCategory = String(course.sub_category || '').trim();
		if (!category.parent_id) return courseCategory === String(category.name || '').trim();
		const parentName = String(parents.get(category.parent_id)?.name || '').trim();
		return courseCategory === parentName && courseSubCategory === String(category.name || '').trim();
	}

	private courseMatchesPackageScope(course: Course, scopeType: PackageScopeType, scopeValue: string) {
		const value = String(scopeValue || '').trim();
		if (scopeType === PackageScopeType.ALL) return true;
		if (scopeType === PackageScopeType.COURSE) return Number(value) === Number(course.id);
		if (scopeType === PackageScopeType.CATEGORY) return String(course.category || '').trim() === value;
		if (scopeType === PackageScopeType.SUB_CATEGORY) return String(course.sub_category || '').trim() === value;
		return false;
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

	private normalizeConfig(value: Partial<AgentPriceExclusionConfig>): AgentPriceExclusionConfig {
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
				? this.courseCategoryRepository.count({ where: { id: In(config.category_ids) } })
				: 0,
			config.package_section_ids.length
				? this.packageSectionRepository.count({ where: { id: In(config.package_section_ids) } })
				: 0,
		]);
		if (categoryCount !== config.category_ids.length) throw new BadRequestException('部分排除分类不存在');
		if (packageCount !== config.package_section_ids.length) throw new BadRequestException('部分排除套餐不存在');
	}

	private async assertAppAdmin(userId: number) {
		const user = await this.appUserRepository.findOne({ where: { id: userId } });
		if (user?.role !== AppUserRole.ADMIN) throw new BadRequestException('仅小程序超级管理员可以设置代理价排除范围');
	}

	private async assertAgentOrAdmin(userId: number) {
		const [user, distributor] = await Promise.all([
			this.appUserRepository.findOne({ where: { id: userId } }),
			this.distributorRepository.findOne({ where: { user_id: userId } }),
		]);
		if (user?.role !== AppUserRole.ADMIN && distributor?.status !== 1) {
			throw new BadRequestException('仅代理商或小程序管理员可以查看代理价规则');
		}
	}
}
