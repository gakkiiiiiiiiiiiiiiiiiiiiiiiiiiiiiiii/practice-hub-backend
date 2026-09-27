import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { PackageSection } from '../../database/entities/package-section.entity';
import { PackageSectionScope, PackageScopeType } from '../../database/entities/package-section-scope.entity';
import { PackagePlan, PackagePlanType } from '../../database/entities/package-plan.entity';
import { UserPackageSubscription } from '../../database/entities/user-package-subscription.entity';
import { Course } from '../../database/entities/course.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order } from '../../database/entities/order.entity';
import { assertIntegerYuanPrice } from '../../common/utils/price.util';
import { grantTrackedPackageDuration, revokeTrackedPackageDuration } from './package-entitlement-ledger';

@Injectable()
export class PackageService {
	private scopeCache: {
		loadedAt: number;
		sections: Array<PackageSection & { scopes: PackageSectionScope[] }>;
	} | null = null;
	private readonly scopeCacheTtlMs = 60_000;
	private ambiguousLegacySubCategoryNames = new Set<string>();
	private subCategoryMetadataLoadedAt = 0;

	constructor(
		@InjectRepository(PackageSection)
		private packageSectionRepository: Repository<PackageSection>,
		@InjectRepository(PackageSectionScope)
		private packageSectionScopeRepository: Repository<PackageSectionScope>,
		@InjectRepository(PackagePlan)
		private packagePlanRepository: Repository<PackagePlan>,
		@InjectRepository(UserPackageSubscription)
		private userPackageSubscriptionRepository: Repository<UserPackageSubscription>,
		@InjectRepository(Course)
		private courseRepository: Repository<Course>,
		@InjectRepository(CourseCategory)
		private courseCategoryRepository: Repository<CourseCategory>,
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
	) {}

	invalidateScopeCache() {
		this.scopeCache = null;
	}

	private async getActiveSectionsWithScopes() {
		await this.refreshSubCategoryMetadata();
		const now = Date.now();
		if (this.scopeCache && now - this.scopeCache.loadedAt < this.scopeCacheTtlMs) {
			return this.scopeCache.sections;
		}
		const sections = await this.packageSectionRepository.find({
			where: { status: 1 },
			relations: ['scopes', 'plans'],
			order: { sort: 'ASC', id: 'ASC' },
		});
		this.scopeCache = { loadedAt: now, sections };
		return sections;
	}

	sectionHasAllCoursesScope(scopes: PackageSectionScope[] = []) {
		return scopes.some((scope) => scope.scope_type === PackageScopeType.ALL);
	}

	courseMatchesScope(course: Course, scope: PackageSectionScope) {
		if (scope.scope_type === PackageScopeType.ALL) {
			return course.status === 1;
		}
		if (scope.scope_type === PackageScopeType.COURSE) {
			return String(course.id) === String(scope.scope_value);
		}
		if (scope.scope_type === PackageScopeType.CATEGORY) {
			return (course.category || '').trim() === scope.scope_value.trim();
		}
		if (scope.scope_type === PackageScopeType.SUB_CATEGORY) {
			const path = this.parseSubCategoryScopeValue(scope.scope_value);
			if (path) {
				return (course.category || '').trim() === path.category && (course.sub_category || '').trim() === path.subCategory;
			}
			const legacyValue = String(scope.scope_value || '').trim();
			if (this.ambiguousLegacySubCategoryNames.has(legacyValue)) return false;
			return (course.sub_category || '').trim() === legacyValue;
		}
		return false;
	}

	async batchUserHasCourseAccessViaPackage(userId: number, courses: Course[]) {
		const accessMap = new Map<number, { hasAccess: boolean; expireTime: Date | null }>();
		if (!userId || courses.length === 0) {
			return accessMap;
		}

		const subscriptions = await this.userPackageSubscriptionRepository.find({
			where: { user_id: userId },
		});
		const activeSubscriptions = subscriptions.filter((item) => item.expire_time > new Date());
		const activeSectionIds = activeSubscriptions.map((item) => item.section_id);
		if (activeSectionIds.length === 0) {
			return accessMap;
		}

		const sections = await this.getActiveSectionsWithScopes();
		const activeSections = sections.filter((section) => activeSectionIds.includes(section.id));
		for (const course of courses) {
			const matchedSections = activeSections.filter((section) => (section.scopes || []).some((scope) => this.courseMatchesScope(course, scope)));
			if (matchedSections.length > 0) {
				const matchedSectionIds = matchedSections.map((section) => section.id);
				const expireTime = activeSubscriptions
					.filter((item) => matchedSectionIds.includes(item.section_id))
					.reduce<Date | null>((max, item) => {
						if (!max || item.expire_time > max) return item.expire_time;
						return max;
					}, null);
				accessMap.set(course.id, { hasAccess: true, expireTime });
			}
		}
		return accessMap;
	}

	async hasAnyActiveSubscription(userId: number) {
		if (!userId) return false;
		return (
			(await this.userPackageSubscriptionRepository.count({
				where: { user_id: userId, expire_time: MoreThan(new Date()) },
			})) > 0
		);
	}

	async userCoursePackageAccess(userId: number, course: Course) {
		const accessMap = await this.batchUserHasCourseAccessViaPackage(userId, [course]);
		return accessMap.get(course.id) || { hasAccess: false, expireTime: null };
	}

	async userHasCourseAccessViaPackage(userId: number, course: Course) {
		return (await this.userCoursePackageAccess(userId, course)).hasAccess;
	}

	async getUserActiveSubscriptions(userId: number) {
		const subscriptions = await this.userPackageSubscriptionRepository.find({
			where: { user_id: userId },
		});
		const active = subscriptions.filter((item) => item.expire_time > new Date());
		if (active.length === 0) return [];

		const sections = await this.packageSectionRepository.find({
			where: { id: In(active.map((s) => s.section_id)) },
		});
		const sectionMap = new Map(sections.map((s) => [s.id, s]));
		return active.map((item) => ({
			sectionId: item.section_id,
			sectionName: sectionMap.get(item.section_id)?.name || '套餐',
			expireTime: item.expire_time,
		}));
	}

	async syncUserPackageExpireTime(userId: number) {
		const subscriptions = await this.userPackageSubscriptionRepository.find({
			where: { user_id: userId },
		});
		const maxExpire = subscriptions.reduce<Date | null>((max, item) => {
			if (item.expire_time <= new Date()) return max;
			if (!max || item.expire_time > max) return item.expire_time;
			return max;
		}, null);
		await this.appUserRepository.update(userId, {
			package_expire_time: maxExpire,
		});
	}

		async revokePackageOrder(order: Order) {
			await this.userPackageSubscriptionRepository.manager.transaction(async (manager) => {
				if (order.package_section_id && await revokeTrackedPackageDuration(manager, {
					userId: order.user_id,
					sectionId: order.package_section_id,
					sourceType: 'order',
					sourceId: order.id,
				})) return;

				const subscription = await manager.findOne(UserPackageSubscription, {
					where: { user_id: order.user_id, order_id: order.id },
				});
				if (!subscription) return;
				await manager.delete(UserPackageSubscription, subscription.id);
				const remaining = await manager.find(UserPackageSubscription, { where: { user_id: order.user_id } });
				const now = new Date();
				const maxExpire = remaining.reduce<Date | null>((max, item) => {
					const value = new Date(item.expire_time);
					return value > now && (!max || value > max) ? value : max;
				}, null);
				await manager.update(AppUser, order.user_id, { package_expire_time: maxExpire });
			});
		}

	async fulfillPackageOrder(order: Order) {
		if (!order.package_section_id || !order.package_plan_id) {
			throw new BadRequestException('套餐订单信息不完整');
		}
		const plan = await this.packagePlanRepository.findOne({
			where: {
				id: order.package_plan_id,
				section_id: order.package_section_id,
			},
		});
		if (!plan) {
			throw new NotFoundException('套餐不存在');
		}

			await this.userPackageSubscriptionRepository.manager.transaction(async (manager) => {
				await grantTrackedPackageDuration(manager, {
					userId: order.user_id,
					sectionId: order.package_section_id,
					durationDays: plan.duration_days,
					sourceType: 'order',
					sourceId: order.id,
				});
			});
	}

	// ---------- Admin ----------

	async adminListSections() {
		const sections = await this.packageSectionRepository.find({
			relations: ['scopes', 'plans'],
			order: { sort: 'ASC', id: 'DESC' },
		});
		return Promise.all(sections.map((section) => this.formatSection(section)));
	}

	async adminGetSection(id: number) {
		const section = await this.packageSectionRepository.findOne({
			where: { id },
			relations: ['scopes', 'plans'],
		});
		if (!section) throw new NotFoundException('套餐不存在');
		return this.formatSection(section);
	}

	async adminCreateSection(input: {
		name: string;
		description?: string;
		cover_img?: string;
		cover_style?: PackageSection['cover_style'];
		status?: number;
		sort?: number;
		scopes?: Array<{ scope_type: PackageScopeType; scope_value?: string }>;
		plans?: Array<{
			plan_type: PackagePlanType;
			name: string;
			price: number;
			duration_days: number;
			status?: number;
			sort?: number;
		}>;
	}) {
		const section = await this.packageSectionRepository.save({
			name: input.name.trim(),
			description: input.description || null,
			cover_img: input.cover_img || null,
			cover_style: input.cover_style ?? null,
			status: input.status ?? 1,
			sort: input.sort ?? 0,
		});
		await this.replaceScopes(section.id, input.scopes || []);
		await this.replacePlans(section.id, input.plans || this.defaultPlans());
		this.invalidateScopeCache();
		return this.adminGetSection(section.id);
	}

	async adminUpdateSection(
		id: number,
		input: {
			name?: string;
			description?: string;
			cover_img?: string;
			cover_style?: PackageSection['cover_style'] | null;
			status?: number;
			sort?: number;
			scopes?: Array<{ scope_type: PackageScopeType; scope_value?: string }>;
			plans?: Array<{
				plan_type: PackagePlanType;
				name: string;
				price: number;
				duration_days: number;
				status?: number;
				sort?: number;
			}>;
		},
	) {
		const section = await this.packageSectionRepository.findOne({
			where: { id },
		});
		if (!section) throw new NotFoundException('套餐不存在');

		if (input.name !== undefined) section.name = input.name.trim();
		if (input.description !== undefined) section.description = input.description || null;
		if (input.cover_img !== undefined) section.cover_img = input.cover_img || null;
		if (input.cover_style !== undefined) section.cover_style = input.cover_style ?? null;
		if (input.status !== undefined) section.status = input.status;
		if (input.sort !== undefined) section.sort = input.sort;
		await this.packageSectionRepository.save(section);

		if (input.scopes) await this.replaceScopes(id, input.scopes);
		if (input.plans) await this.replacePlans(id, input.plans);
		this.invalidateScopeCache();
		return this.adminGetSection(id);
	}

	async adminDeleteSection(id: number) {
		await this.packageSectionScopeRepository.delete({ section_id: id });
		await this.packagePlanRepository.delete({ section_id: id });
		await this.packageSectionRepository.delete(id);
		this.invalidateScopeCache();
		return { success: true };
	}

	private defaultPlans() {
		return [
			{
				plan_type: PackagePlanType.MONTHLY,
				name: '月卡',
				price: 30,
				duration_days: 30,
				status: 1,
				sort: 1,
			},
			{
				plan_type: PackagePlanType.QUARTERLY,
				name: '季卡',
				price: 80,
				duration_days: 90,
				status: 1,
				sort: 2,
			},
			{
				plan_type: PackagePlanType.YEARLY,
				name: '年卡',
				price: 200,
				duration_days: 365,
				status: 1,
				sort: 3,
			},
		];
	}

	private async replaceScopes(sectionId: number, scopes: Array<{ scope_type: PackageScopeType; scope_value?: string }>) {
		const normalizedScopes = await Promise.all(
			scopes.map(async (item) => ({
				...item,
				scope_value: item.scope_type === PackageScopeType.SUB_CATEGORY ? await this.normalizeSubCategoryScopeValue(item.scope_value) : item.scope_value,
			})),
		);
		await this.packageSectionScopeRepository.delete({ section_id: sectionId });
		const safeScopes = normalizedScopes
			.map((item) => ({
				section_id: sectionId,
				scope_type: item.scope_type,
				scope_value: item.scope_type === PackageScopeType.ALL ? String(item.scope_value || '*').trim() || '*' : String(item.scope_value || '').trim(),
			}))
			.filter((item) => item.scope_type === PackageScopeType.ALL || item.scope_value);
		if (safeScopes.length > 0) {
			await this.packageSectionScopeRepository.save(safeScopes);
		}
	}

	private async replacePlans(
		sectionId: number,
		plans: Array<{
			plan_type: PackagePlanType;
			name: string;
			price: number;
			duration_days: number;
			status?: number;
			sort?: number;
		}>,
	) {
		await this.packagePlanRepository.delete({ section_id: sectionId });
		const safePlans = plans.map((plan, index) => {
			const rawPrice = Number(plan.price) || 0;
			if (rawPrice > 0) {
				assertIntegerYuanPrice(rawPrice, '套餐价格');
			}
			return {
				section_id: sectionId,
				plan_type: plan.plan_type,
				name: plan.name.trim(),
				price: Math.max(0, rawPrice),
				duration_days: Math.max(1, Number(plan.duration_days) || 30),
				status: plan.status ?? 1,
				sort: plan.sort ?? index + 1,
			};
		});
		if (safePlans.length > 0) {
			await this.packagePlanRepository.save(safePlans);
		}
	}

	private async resolveScopeCategoryLabels(scopes: PackageSectionScope[] = []) {
		const labels: string[] = [];
		const seen = new Set<string>();
		const pushLabel = (label: string) => {
			const normalized = String(label || '').trim();
			if (!normalized || seen.has(normalized)) return;
			seen.add(normalized);
			labels.push(normalized);
		};

		const courseIds = scopes
			.filter((scope) => scope.scope_type === PackageScopeType.COURSE)
			.map((scope) => Number(scope.scope_value))
			.filter((id) => Number.isInteger(id) && id > 0);
		const courseMap = new Map<number, Course>();
		if (courseIds.length > 0) {
			const courses = await this.courseRepository.find({
				where: { id: In(courseIds) },
			});
			courses.forEach((course) => courseMap.set(course.id, course));
		}

		for (const scope of scopes) {
			if (scope.scope_type === PackageScopeType.ALL) {
				pushLabel('全站课程');
				continue;
			}
			const value = String(scope.scope_value || '').trim();
			if (!value) continue;
			if (scope.scope_type === PackageScopeType.CATEGORY) {
				pushLabel(value);
				continue;
			}
			if (scope.scope_type === PackageScopeType.SUB_CATEGORY) {
				const path = this.parseSubCategoryScopeValue(value);
				pushLabel(path ? `${path.category} · ${path.subCategory}` : value);
				continue;
			}
			if (scope.scope_type === PackageScopeType.COURSE) {
				const course = courseMap.get(Number(value));
				if (!course) continue;
				if (course.category && course.sub_category) {
					pushLabel(`${course.category} · ${course.sub_category}`);
				} else if (course.category) {
					pushLabel(course.category);
				} else if (course.sub_category) {
					pushLabel(course.sub_category);
				}
			}
		}

		return labels;
	}

	private async formatSection(section: PackageSection) {
		const scopeCategoryLabels = await this.resolveScopeCategoryLabels(section.scopes || []);
		const coversAllCourses = this.sectionHasAllCoursesScope(section.scopes || []);
		return {
			id: section.id,
			name: section.name,
			description: section.description,
			coverImg: section.cover_img,
			coverStyle: section.cover_style,
			coverFallbackText: scopeCategoryLabels.join('、'),
			scopeCategoryLabels,
			coversAllCourses,
			isVip: coversAllCourses,
			status: section.status,
			sort: section.sort,
			scopes: (section.scopes || []).map((scope) => ({
				id: scope.id,
				scopeType: scope.scope_type,
				scopeValue: scope.scope_value,
			})),
			plans: (section.plans || [])
				.sort((a, b) => a.sort - b.sort)
				.map((plan) => ({
					id: plan.id,
					planType: plan.plan_type,
					name: plan.name,
					price: Number(plan.price),
					durationDays: plan.duration_days,
					status: plan.status,
					sort: plan.sort,
				})),
			createTime: section.create_time,
			updateTime: section.update_time,
		};
	}

	// ---------- App ----------

	async getRelatedSectionsForCourse(course: Course, userId?: number) {
		const sections = await this.getActiveSectionsWithScopes();
		const matchedSections = sections.filter((section) => (section.scopes || []).some((scope) => this.courseMatchesScope(course, scope)));
		if (matchedSections.length === 0) return [];

		let subscriptionMap = new Map<number, UserPackageSubscription>();
		if (userId) {
			const subscriptions = await this.userPackageSubscriptionRepository.find({
				where: { user_id: userId },
			});
			subscriptionMap = new Map(subscriptions.map((item) => [item.section_id, item]));
		}

		return Promise.all(
			matchedSections.map(async (section) => {
				const subscription = subscriptionMap.get(section.id);
				const active = subscription && subscription.expire_time > new Date();
				const plans = (section.plans || [])
					.filter((plan) => plan.status === 1)
					.sort((a, b) => a.sort - b.sort)
					.map((plan) => ({
						id: plan.id,
						planType: plan.plan_type,
						name: plan.name,
						price: Number(plan.price),
						durationDays: plan.duration_days,
					}));
				const minPrice = plans.length ? Math.min(...plans.map((plan) => plan.price)) : 0;
				const scopeCategoryLabels = await this.resolveScopeCategoryLabels(section.scopes || []);
				const coversAllCourses = this.sectionHasAllCoursesScope(section.scopes || []);
				return {
					id: section.id,
					name: section.name,
					description: section.description,
					coverImg: section.cover_img,
					coverFallbackText: scopeCategoryLabels.join('、'),
					coversAllCourses,
					isVip: coversAllCourses,
					plans,
					minPrice,
					subscribed: !!active,
					expireTime: active ? subscription?.expire_time : null,
				};
			}),
		);
	}

	async getAppSectionList(userId?: number) {
		const sections = await this.packageSectionRepository.find({
			where: { status: 1 },
			relations: ['scopes', 'plans'],
			order: { sort: 'ASC', id: 'ASC' },
		});
		let subscriptionMap = new Map<number, UserPackageSubscription>();
		if (userId) {
			const subscriptions = await this.userPackageSubscriptionRepository.find({
				where: { user_id: userId },
			});
			subscriptionMap = new Map(subscriptions.map((item) => [item.section_id, item]));
		}

		return Promise.all(
			sections.map(async (section) => {
				const subscription = subscriptionMap.get(section.id);
				const active = subscription && subscription.expire_time > new Date();
				const scopeCategoryLabels = await this.resolveScopeCategoryLabels(section.scopes || []);
				const coversAllCourses = this.sectionHasAllCoursesScope(section.scopes || []);
				return {
					id: section.id,
					name: section.name,
					description: section.description,
					coverImg: section.cover_img,
					coverFallbackText: scopeCategoryLabels.join('、'),
					coversAllCourses,
					isVip: coversAllCourses,
					plans: (section.plans || [])
						.filter((plan) => plan.status === 1)
						.sort((a, b) => a.sort - b.sort)
						.map((plan) => ({
							id: plan.id,
							planType: plan.plan_type,
							name: plan.name,
							price: Number(plan.price),
							durationDays: plan.duration_days,
						})),
					subscribed: !!active,
					expireTime: active ? subscription?.expire_time : null,
				};
			}),
		);
	}

	async getAppSectionDetail(sectionId: number, userId?: number) {
		await this.refreshSubCategoryMetadata();
		const section = await this.packageSectionRepository.findOne({
			where: { id: sectionId, status: 1 },
			relations: ['scopes', 'plans'],
		});
		if (!section) throw new NotFoundException('套餐不存在');

		const coversAllCourses = this.sectionHasAllCoursesScope(section.scopes || []);
		const courseMap = new Map<number, Course>();

		if (coversAllCourses) {
			const allCourses = await this.courseRepository.find({
				where: { status: 1 },
				order: { sort: 'ASC', id: 'ASC' },
			});
			allCourses.forEach((course) => courseMap.set(course.id, course));
		} else {
			const courseIds = (section.scopes || [])
				.filter((scope) => scope.scope_type === PackageScopeType.COURSE)
				.map((scope) => Number(scope.scope_value))
				.filter((id) => Number.isInteger(id) && id > 0);

			let courses: Course[] = [];
			if (courseIds.length > 0) {
				courses = await this.courseRepository.find({
					where: { id: In(courseIds), status: 1 },
				});
			}

			const categoryScopes = (section.scopes || []).filter(
				(scope) => scope.scope_type !== PackageScopeType.COURSE && scope.scope_type !== PackageScopeType.ALL,
			);
			let categoryCourses: Course[] = [];
			if (categoryScopes.length > 0) {
				const allCourses = await this.courseRepository.find({
					where: { status: 1 },
				});
				categoryCourses = allCourses.filter((course) =>
					(section.scopes || []).some(
						(scope) => scope.scope_type !== PackageScopeType.COURSE && scope.scope_type !== PackageScopeType.ALL && this.courseMatchesScope(course, scope),
					),
				);
			}

			[...courses, ...categoryCourses].forEach((course) => courseMap.set(course.id, course));
		}

		let subscription: UserPackageSubscription | null = null;
		if (userId) {
			subscription = await this.userPackageSubscriptionRepository.findOne({
				where: { user_id: userId, section_id: sectionId },
			});
		}
		const active = subscription && subscription.expire_time > new Date();

		const allCourses = Array.from(courseMap.values());
		const previewCourses = coversAllCourses ? allCourses.slice(0, 30) : allCourses;
		const coursesTotalPrice = this.sumCoursesPrice(allCourses);
		const formatted = await this.formatSection(section);
		const enabledPlans = (formatted.plans || []).filter((plan) => plan.status === 1);

		return {
			...formatted,
			plans: enabledPlans,
			courses: previewCourses.map((course) => ({
				id: course.id,
				name: course.name,
				coverImg: course.cover_img,
				category: course.category,
				subCategory: course.sub_category,
				price: Number(course.price),
				isFree: course.is_free === 1,
			})),
			courseCount: allCourses.length,
			coursesTotalPrice,
			subscribed: !!active,
			expireTime: active ? subscription?.expire_time : null,
		};
	}

	private sumCoursesPrice(courses: Course[]) {
		return courses.reduce((sum, course) => {
			if (course.is_free === 1) return sum;
			const price = Number(course.price) || 0;
			return sum + Math.max(0, price);
		}, 0);
	}

	private parseSubCategoryScopeValue(value?: string) {
		const normalized = String(value || '').trim();
		if (!normalized.startsWith('[')) return null;
		try {
			const path = JSON.parse(normalized);
			if (!Array.isArray(path) || path.length !== 2) return null;
			const category = String(path[0] || '').trim();
			const subCategory = String(path[1] || '').trim();
			return category && subCategory ? { category, subCategory } : null;
		} catch {
			return null;
		}
	}

	private async normalizeSubCategoryScopeValue(value?: string) {
		const normalized = String(value || '').trim();
		const path = this.parseSubCategoryScopeValue(normalized);
		if (path) return JSON.stringify([path.category, path.subCategory]);
		if (!normalized) return '';

		const matches = await this.courseCategoryRepository.find({
			where: { name: normalized },
		});
		const childMatches = matches.filter((item) => Number(item.parent_id) > 0);
		if (childMatches.length !== 1) {
			throw new BadRequestException(
				childMatches.length > 1 ? `二级分类“${normalized}”存在于多个一级分类下，请重新选择完整分类路径` : `二级分类“${normalized}”不存在，请重新选择`,
			);
		}
		const parent = await this.courseCategoryRepository.findOne({
			where: { id: childMatches[0].parent_id },
		});
		if (!parent) throw new BadRequestException(`二级分类“${normalized}”的一级分类不存在，请重新选择`);
		return JSON.stringify([parent.name.trim(), childMatches[0].name.trim()]);
	}

	private async refreshSubCategoryMetadata() {
		const now = Date.now();
		if (now - this.subCategoryMetadataLoadedAt < this.scopeCacheTtlMs) return;
		const categories = await this.courseCategoryRepository.find();
		const counts = new Map<string, number>();
		categories
			.filter((item) => Number(item.parent_id) > 0)
			.forEach((item) => {
				const name = String(item.name || '').trim();
				if (name) counts.set(name, (counts.get(name) || 0) + 1);
			});
		this.ambiguousLegacySubCategoryNames = new Set(
			Array.from(counts.entries())
				.filter(([, count]) => count > 1)
				.map(([name]) => name),
		);
		this.subCategoryMetadataLoadedAt = now;
	}

	async getPlanForOrder(sectionId: number, planId: number) {
		const plan = await this.packagePlanRepository.findOne({
			where: { id: planId, section_id: sectionId, status: 1 },
			relations: ['section'],
		});
		if (!plan || !plan.section || plan.section.status !== 1) {
			throw new NotFoundException('套餐不存在或已下架');
		}
		return plan;
	}
}
