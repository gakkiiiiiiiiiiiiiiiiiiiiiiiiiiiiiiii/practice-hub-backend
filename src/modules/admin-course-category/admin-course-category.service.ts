import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Course } from '../../database/entities/course.entity';
import { queryWithRetry } from '../../common/utils/database-retry';
import { BatchDeleteCourseCategoriesDto } from './dto/batch-delete-course-categories.dto';
import { BatchUpdateCourseCategoriesStatusDto } from './dto/batch-update-course-categories-status.dto';
import { CreateCourseCategoryDto } from './dto/create-course-category.dto';
import { UpdateCourseCategoryDto } from './dto/update-course-category.dto';

@Injectable()
export class AdminCourseCategoryService {
	private readonly logger = new Logger(AdminCourseCategoryService.name);

	constructor(
		@InjectRepository(CourseCategory)
		private courseCategoryRepository: Repository<CourseCategory>,
		@InjectRepository(Course)
		private courseRepository: Repository<Course>,
		private readonly dataSource: DataSource,
	) {}

	async getCategoryTree(status?: number) {
		const where = status !== undefined ? { status } : {};
		const categories = await this.courseCategoryRepository.find({
			where,
			order: { sort: 'ASC', id: 'ASC' },
		});

		const categoryMap = new Map<number, any>();
		categories.forEach((category) => {
			categoryMap.set(category.id, { ...category, children: [] });
		});

		const tree: any[] = [];
		categoryMap.forEach((category) => {
			if (category.parent_id) {
				const parent = categoryMap.get(category.parent_id);
				if (parent) {
					parent.children.push(category);
				}
			} else {
				tree.push(category);
			}
		});

		return tree;
	}

	async createCategory(dto: CreateCourseCategoryDto) {
		// 如果指定了父级分类，验证父级分类必须是一级分类（不能是二级分类）
		if (dto.parent_id !== null && dto.parent_id !== undefined) {
			const parentCategory = await this.courseCategoryRepository.findOne({
				where: { id: dto.parent_id },
			});
			if (!parentCategory) {
				throw new BadRequestException('父级分类不存在');
			}
			// 如果父级分类本身也有父级（即它是二级分类），则不允许添加子分类
			if (parentCategory.parent_id !== null && parentCategory.parent_id !== undefined) {
				throw new BadRequestException('二级分类不允许新增子分类');
			}
		}

		const category = this.courseCategoryRepository.create({
			name: dto.name,
			parent_id: dto.parent_id ?? null,
			cover_img: dto.cover_img ?? null,
			bundle_price: dto.bundle_price ?? 30,
			sort: dto.sort ?? 0,
			status: dto.status ?? 1,
		});
		return this.courseCategoryRepository.save(category);
	}

	async updateCategory(id: number, dto: UpdateCourseCategoryDto) {
		return queryWithRetry(() => this.executeUpdateCategory(id, dto), {
			action: '更新课程分类',
			logger: this.logger,
			retries: 3,
			delayMs: 500,
		});
	}

	private async executeUpdateCategory(id: number, dto: UpdateCourseCategoryDto) {
		return this.dataSource.transaction(async (manager) => {
			const categoryRepo = manager.getRepository(CourseCategory);
			const courseRepo = manager.getRepository(Course);

			const category = await categoryRepo.findOne({ where: { id } });
			if (!category) {
				throw new NotFoundException('分类不存在');
			}

			const oldName = category.name;
			const oldParentId = category.parent_id ?? null;
			const isSecondary = oldParentId !== null && oldParentId !== undefined;

			let newParentId = oldParentId;
			if (dto.parent_id !== undefined) {
				if (!isSecondary && dto.parent_id !== null && dto.parent_id !== undefined) {
					throw new BadRequestException('一级分类不能设置上级分类');
				}
				if (isSecondary && (dto.parent_id === null || dto.parent_id === undefined)) {
					throw new BadRequestException('二级分类不能改为一级分类');
				}
				newParentId = dto.parent_id ?? null;
			}

			if (newParentId === id) {
				throw new BadRequestException('不能将自身设为上级分类');
			}

			if (newParentId !== null && newParentId !== undefined && newParentId !== oldParentId) {
				const parentCategory = await categoryRepo.findOne({
					where: { id: newParentId },
				});
				if (!parentCategory) {
					throw new BadRequestException('父级分类不存在');
				}
				if (parentCategory.parent_id !== null && parentCategory.parent_id !== undefined) {
					throw new BadRequestException('二级分类不允许作为父级分类');
				}
			}

			const parentNameRows = await categoryRepo.find({
				where: { id: In([oldParentId, newParentId].filter((value): value is number => Number.isInteger(value) && value > 0)) },
				select: ['id', 'name'],
			});
			const parentNameMap = new Map(parentNameRows.map((row) => [row.id, row.name]));
			const oldParentName = oldParentId ? parentNameMap.get(oldParentId) ?? null : null;
			const newParentName = newParentId ? parentNameMap.get(newParentId) ?? null : null;
			const nextName = dto.name ?? category.name;

			Object.assign(category, {
				...dto,
				parent_id: newParentId,
				name: nextName,
			});
			const savedCategory = await categoryRepo.save(category);

			let syncedCourseCount = 0;
			if (isSecondary && newParentId) {
				if (oldParentName && newParentName && (oldParentName !== newParentName || oldName !== nextName)) {
					const updateResult = await courseRepo.update(
						{ category: oldParentName, sub_category: oldName },
						{ category: newParentName, sub_category: nextName },
					);
					syncedCourseCount = updateResult.affected || 0;
				}
			} else if (!isSecondary && oldName !== nextName) {
				const updateResult = await courseRepo.update({ category: oldName }, { category: nextName });
				syncedCourseCount = updateResult.affected || 0;
			}

			return {
				...savedCategory,
				syncedCourseCount,
			};
		});
	}

	async deleteCategory(id: number) {
		const category = await this.courseCategoryRepository.findOne({ where: { id } });
		if (!category) {
			throw new NotFoundException('分类不存在');
		}

		const childCount = await this.courseCategoryRepository.count({
			where: { parent_id: id },
		});
		if (childCount > 0) {
			throw new BadRequestException('请先删除子分类');
		}

		if (category.parent_id) {
			const usedCount = await this.courseRepository.count({
				where: { sub_category: category.name },
			});
			if (usedCount > 0) {
				throw new BadRequestException('该分类已被课程使用，无法删除');
			}
		} else {
			const usedCount = await this.courseRepository.count({
				where: { category: category.name },
			});
			if (usedCount > 0) {
				throw new BadRequestException('该分类已被课程使用，无法删除');
			}
		}

		await this.courseCategoryRepository.remove(category);
		return { success: true };
	}

	async batchDeleteCategories(dto: BatchDeleteCourseCategoriesDto) {
		if (!dto.ids || dto.ids.length === 0) {
			throw new BadRequestException('分类ID列表不能为空');
		}

		const categories = await this.courseCategoryRepository.find({
			where: { id: In(dto.ids) },
		});

		if (categories.length === 0) {
			throw new NotFoundException('未找到要删除的分类');
		}

		const sortedCategories = [...categories].sort((a, b) => {
			if (a.parent_id && !b.parent_id) return -1;
			if (!a.parent_id && b.parent_id) return 1;
			return b.id - a.id;
		});

		for (const category of sortedCategories) {
			await this.deleteCategory(category.id);
		}

		return {
			success: true,
			count: categories.length,
		};
	}

	async batchUpdateStatus(dto: BatchUpdateCourseCategoriesStatusDto) {
		if (!dto.ids || dto.ids.length === 0) {
			throw new BadRequestException('分类ID列表不能为空');
		}

		const categories = await this.courseCategoryRepository.find({
			where: { id: In(dto.ids) },
		});

		if (categories.length === 0) {
			throw new NotFoundException('未找到要更新的分类');
		}

		await this.courseCategoryRepository.update(
			{ id: In(dto.ids) },
			{ status: dto.status },
		);

		return {
			success: true,
			count: categories.length,
			status: dto.status,
		};
	}
}
