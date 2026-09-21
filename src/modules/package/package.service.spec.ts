import { BadRequestException } from '@nestjs/common';
import { PackageScopeType } from '../../database/entities/package-section-scope.entity';
import { PackageService } from './package.service';

describe('PackageService category scopes', () => {
	const createService = (categories: any[] = []) =>
		new PackageService(
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{
				find: jest.fn().mockResolvedValue(categories),
				findOne: jest.fn().mockImplementation(({ where }) => Promise.resolve(categories.find((item) => item.id === where.id) || null)),
			} as any,
			{} as any,
		);

	it('matches a second-level category only inside its selected parent category', () => {
		const service = createService();
		const scope = {
			scope_type: PackageScopeType.SUB_CATEGORY,
			scope_value: JSON.stringify(['考研专业课', '材料科学']),
		} as any;

		expect(service.courseMatchesScope({ category: '考研专业课', sub_category: '材料科学' } as any, scope)).toBe(true);
		expect(service.courseMatchesScope({ category: '考研真题', sub_category: '材料科学' } as any, scope)).toBe(false);
	});

	it('blocks ambiguous legacy second-level category names instead of widening package access', async () => {
		const service = createService([
			{ id: 1, name: '考研专业课', parent_id: null },
			{ id: 2, name: '考研真题', parent_id: null },
			{ id: 3, name: '材料科学', parent_id: 1 },
			{ id: 4, name: '材料科学', parent_id: 2 },
		]);
		await (service as any).refreshSubCategoryMetadata();
		const legacyScope = {
			scope_type: PackageScopeType.SUB_CATEGORY,
			scope_value: '材料科学',
		} as any;

		expect(service.courseMatchesScope({ category: '考研专业课', sub_category: '材料科学' } as any, legacyScope)).toBe(false);
		expect(service.courseMatchesScope({ category: '考研真题', sub_category: '材料科学' } as any, legacyScope)).toBe(false);
	});

	it('rejects ambiguous legacy values when an admin saves a package', async () => {
		const service = createService([
			{ id: 3, name: '材料科学', parent_id: 1 },
			{ id: 4, name: '材料科学', parent_id: 2 },
		]);

		await expect((service as any).normalizeSubCategoryScopeValue('材料科学')).rejects.toBeInstanceOf(BadRequestException);
	});
});
