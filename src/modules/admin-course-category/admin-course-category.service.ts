import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Course } from '../../database/entities/course.entity';
import { CreateCourseCategoryDto } from './dto/create-course-category.dto';
import { UpdateCourseCategoryDto } from './dto/update-course-category.dto';

@Injectable()
export class AdminCourseCategoryService {
	constructor(
		@InjectRepository(CourseCategory)
		private courseCategoryRepository: Repository<CourseCategory>,
		@InjectRepository(Course)
		private courseRepository: Repository<Course>,
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
			sort: dto.sort ?? 0,
			status: dto.status ?? 1,
		});
		return this.courseCategoryRepository.save(category);
	}

	async updateCategory(id: number, dto: UpdateCourseCategoryDto) {
		const category = await this.courseCategoryRepository.findOne({ where: { id } });
		if (!category) {
			throw new NotFoundException('分类不存在');
		}

		// 如果更新了父级分类，验证父级分类必须是一级分类（不能是二级分类）
		const newParentId = dto.parent_id ?? category.parent_id ?? null;
		if (newParentId !== null && newParentId !== undefined && newParentId !== category.parent_id) {
			const parentCategory = await this.courseCategoryRepository.findOne({
				where: { id: newParentId },
			});
			if (!parentCategory) {
				throw new BadRequestException('父级分类不存在');
			}
			// 如果父级分类本身也有父级（即它是二级分类），则不允许设置为父级
			if (parentCategory.parent_id !== null && parentCategory.parent_id !== undefined) {
				throw new BadRequestException('二级分类不允许作为父级分类');
			}
		}

		const oldName = category.name;
		const nextName = dto.name ?? category.name;

		Object.assign(category, {
			...dto,
			parent_id: newParentId,
		});
		await this.courseCategoryRepository.save(category);

		if (oldName !== nextName) {
			if (category.parent_id) {
				await this.courseRepository.update(
					{ sub_category: oldName },
					{ sub_category: nextName },
				);
			} else {
				await this.courseRepository.update(
					{ category: oldName },
					{ category: nextName },
				);
			}
		}

		return category;
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
}
