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

		const oldName = category.name;
		const nextName = dto.name ?? category.name;

		Object.assign(category, {
			...dto,
			parent_id: dto.parent_id ?? category.parent_id ?? null,
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
