import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PackageSection } from '../../database/entities/package-section.entity';
import { PackageSectionScope, PackageScopeType } from '../../database/entities/package-section-scope.entity';
import { PackagePlan, PackagePlanType } from '../../database/entities/package-plan.entity';
import { UserPackageSubscription } from '../../database/entities/user-package-subscription.entity';
import { Course } from '../../database/entities/course.entity';
import { AppUser } from '../../database/entities/app-user.entity';
import { Order } from '../../database/entities/order.entity';

@Injectable()
export class PackageService {
	private scopeCache: { loadedAt: number; sections: Array<PackageSection & { scopes: PackageSectionScope[] }> } | null = null;
	private readonly scopeCacheTtlMs = 60_000;

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
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
	) {}

	invalidateScopeCache() {
		this.scopeCache = null;
	}

	private async getActiveSectionsWithScopes() {
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

	courseMatchesScope(course: Course, scope: PackageSectionScope) {
		if (scope.scope_type === PackageScopeType.COURSE) {
			return String(course.id) === String(scope.scope_value);
		}
		if (scope.scope_type === PackageScopeType.CATEGORY) {
			return (course.category || '').trim() === scope.scope_value.trim();
		}
		if (scope.scope_type === PackageScopeType.SUB_CATEGORY) {
			return (course.sub_category || '').trim() === scope.scope_value.trim();
		}
		return false;
	}

	async userHasCourseAccessViaPackage(userId: number, course: Course) {
		const subscriptions = await this.userPackageSubscriptionRepository.find({
			where: { user_id: userId },
		});
		const activeSectionIds = subscriptions
			.filter((item) => item.expire_time > new Date())
			.map((item) => item.section_id);
		if (activeSectionIds.length === 0) return false;

		const sections = await this.getActiveSectionsWithScopes();
		return sections.some(
			(section) =>
				activeSectionIds.includes(section.id) &&
				(section.scopes || []).some((scope) => this.courseMatchesScope(course, scope)),
		);
	}

	async getUserActiveSubscriptions(userId: number) {
		const subscriptions = await this.userPackageSubscriptionRepository.find({ where: { user_id: userId } });
		const active = subscriptions.filter((item) => item.expire_time > new Date());
		if (active.length === 0) return [];

		const sections = await this.packageSectionRepository.find({ where: { id: In(active.map((s) => s.section_id)) } });
		const sectionMap = new Map(sections.map((s) => [s.id, s]));
		return active.map((item) => ({
			sectionId: item.section_id,
			sectionName: sectionMap.get(item.section_id)?.name || '套餐',
			expireTime: item.expire_time,
		}));
	}

	async syncUserPackageExpireTime(userId: number) {
		const subscriptions = await this.userPackageSubscriptionRepository.find({ where: { user_id: userId } });
		const maxExpire = subscriptions.reduce<Date | null>((max, item) => {
			if (item.expire_time <= new Date()) return max;
			if (!max || item.expire_time > max) return item.expire_time;
			return max;
		}, null);
		await this.appUserRepository.update(userId, { package_expire_time: maxExpire });
	}

	async fulfillPackageOrder(order: Order) {
		if (!order.package_section_id || !order.package_plan_id) {
			throw new BadRequestException('套餐订单信息不完整');
		}
		const plan = await this.packagePlanRepository.findOne({ where: { id: order.package_plan_id, section_id: order.package_section_id } });
		if (!plan) {
			throw new NotFoundException('套餐不存在');
		}

		const now = new Date();
		let subscription = await this.userPackageSubscriptionRepository.findOne({
			where: { user_id: order.user_id, section_id: order.package_section_id },
		});
		const baseTime = subscription && subscription.expire_time > now ? subscription.expire_time : now;
		const expireTime = new Date(baseTime);
		expireTime.setDate(expireTime.getDate() + plan.duration_days);

		if (!subscription) {
			subscription = this.userPackageSubscriptionRepository.create({
				user_id: order.user_id,
				section_id: order.package_section_id,
				expire_time: expireTime,
				order_id: order.id,
			});
		} else {
			subscription.expire_time = expireTime;
			subscription.order_id = order.id;
		}
		await this.userPackageSubscriptionRepository.save(subscription);
		await this.syncUserPackageExpireTime(order.user_id);
	}

	// ---------- Admin ----------

	async adminListSections() {
		const sections = await this.packageSectionRepository.find({
			relations: ['scopes', 'plans'],
			order: { sort: 'ASC', id: 'DESC' },
		});
		return sections.map((section) => this.formatSection(section));
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
		status?: number;
		sort?: number;
		scopes?: Array<{ scope_type: PackageScopeType; scope_value: string }>;
		plans?: Array<{ plan_type: PackagePlanType; name: string; price: number; duration_days: number; status?: number; sort?: number }>;
	}) {
		const section = await this.packageSectionRepository.save({
			name: input.name.trim(),
			description: input.description || null,
			cover_img: input.cover_img || null,
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
			status?: number;
			sort?: number;
			scopes?: Array<{ scope_type: PackageScopeType; scope_value: string }>;
			plans?: Array<{ plan_type: PackagePlanType; name: string; price: number; duration_days: number; status?: number; sort?: number }>;
		},
	) {
		const section = await this.packageSectionRepository.findOne({ where: { id } });
		if (!section) throw new NotFoundException('套餐不存在');

		if (input.name !== undefined) section.name = input.name.trim();
		if (input.description !== undefined) section.description = input.description || null;
		if (input.cover_img !== undefined) section.cover_img = input.cover_img || null;
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
			{ plan_type: PackagePlanType.MONTHLY, name: '月卡', price: 29.9, duration_days: 30, status: 1, sort: 1 },
			{ plan_type: PackagePlanType.QUARTERLY, name: '季卡', price: 79.9, duration_days: 90, status: 1, sort: 2 },
			{ plan_type: PackagePlanType.YEARLY, name: '年卡', price: 199.9, duration_days: 365, status: 1, sort: 3 },
		];
	}

	private async replaceScopes(sectionId: number, scopes: Array<{ scope_type: PackageScopeType; scope_value: string }>) {
		await this.packageSectionScopeRepository.delete({ section_id: sectionId });
		const safeScopes = scopes
			.map((item) => ({
				section_id: sectionId,
				scope_type: item.scope_type,
				scope_value: String(item.scope_value || '').trim(),
			}))
			.filter((item) => item.scope_value);
		if (safeScopes.length > 0) {
			await this.packageSectionScopeRepository.save(safeScopes);
		}
	}

	private async replacePlans(
		sectionId: number,
		plans: Array<{ plan_type: PackagePlanType; name: string; price: number; duration_days: number; status?: number; sort?: number }>,
	) {
		await this.packagePlanRepository.delete({ section_id: sectionId });
		const safePlans = plans.map((plan, index) => ({
			section_id: sectionId,
			plan_type: plan.plan_type,
			name: plan.name.trim(),
			price: Math.max(0, Number(plan.price) || 0),
			duration_days: Math.max(1, Number(plan.duration_days) || 30),
			status: plan.status ?? 1,
			sort: plan.sort ?? index + 1,
		}));
		if (safePlans.length > 0) {
			await this.packagePlanRepository.save(safePlans);
		}
	}

	private formatSection(section: PackageSection) {
		return {
			id: section.id,
			name: section.name,
			description: section.description,
			coverImg: section.cover_img,
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
		const matchedSections = sections.filter((section) =>
			(section.scopes || []).some((scope) => this.courseMatchesScope(course, scope)),
		);
		if (matchedSections.length === 0) return [];

		let subscriptionMap = new Map<number, UserPackageSubscription>();
		if (userId) {
			const subscriptions = await this.userPackageSubscriptionRepository.find({ where: { user_id: userId } });
			subscriptionMap = new Map(subscriptions.map((item) => [item.section_id, item]));
		}

		return matchedSections.map((section) => {
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
			return {
				id: section.id,
				name: section.name,
				description: section.description,
				coverImg: section.cover_img,
				plans,
				minPrice,
				subscribed: !!active,
				expireTime: active ? subscription?.expire_time : null,
			};
		});
	}

	async getAppSectionList(userId?: number) {
		const sections = await this.packageSectionRepository.find({
			where: { status: 1 },
			relations: ['scopes', 'plans'],
			order: { sort: 'ASC', id: 'ASC' },
		});
		let subscriptionMap = new Map<number, UserPackageSubscription>();
		if (userId) {
			const subscriptions = await this.userPackageSubscriptionRepository.find({ where: { user_id: userId } });
			subscriptionMap = new Map(subscriptions.map((item) => [item.section_id, item]));
		}

		return sections.map((section) => {
			const subscription = subscriptionMap.get(section.id);
			const active = subscription && subscription.expire_time > new Date();
			return {
				id: section.id,
				name: section.name,
				description: section.description,
				coverImg: section.cover_img,
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
		});
	}

	async getAppSectionDetail(sectionId: number, userId?: number) {
		const section = await this.packageSectionRepository.findOne({
			where: { id: sectionId, status: 1 },
			relations: ['scopes', 'plans'],
		});
		if (!section) throw new NotFoundException('套餐不存在');

		const courseIds = (section.scopes || [])
			.filter((scope) => scope.scope_type === PackageScopeType.COURSE)
			.map((scope) => Number(scope.scope_value))
			.filter((id) => Number.isInteger(id) && id > 0);

		let courses: Course[] = [];
		if (courseIds.length > 0) {
			courses = await this.courseRepository.find({ where: { id: In(courseIds), status: 1 } });
		}

		const categoryScopes = (section.scopes || []).filter((scope) => scope.scope_type !== PackageScopeType.COURSE);
		let categoryCourses: Course[] = [];
		if (categoryScopes.length > 0) {
			const allCourses = await this.courseRepository.find({ where: { status: 1 } });
			categoryCourses = allCourses.filter((course) =>
				(section.scopes || []).some((scope) => scope.scope_type !== PackageScopeType.COURSE && this.courseMatchesScope(course, scope)),
			);
		}

		const courseMap = new Map<number, Course>();
		[...courses, ...categoryCourses].forEach((course) => courseMap.set(course.id, course));

		let subscription: UserPackageSubscription | null = null;
		if (userId) {
			subscription = await this.userPackageSubscriptionRepository.findOne({
				where: { user_id: userId, section_id: sectionId },
			});
		}
		const active = subscription && subscription.expire_time > new Date();

		return {
			...this.formatSection(section),
			courses: Array.from(courseMap.values()).map((course) => ({
				id: course.id,
				name: course.name,
				coverImg: course.cover_img,
				category: course.category,
				subCategory: course.sub_category,
				price: Number(course.price),
			})),
			subscribed: !!active,
			expireTime: active ? subscription?.expire_time : null,
		};
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
