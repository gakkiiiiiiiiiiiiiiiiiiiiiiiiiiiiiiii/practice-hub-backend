import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HomeRecommendCategory } from '../../database/entities/home-recommend-category.entity';
import { HomeRecommendItem } from '../../database/entities/home-recommend-item.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemSortDto } from './dto/update-item-sort.dto';

@Injectable()
export class RecommendService {
  constructor(
    @InjectRepository(HomeRecommendCategory)
    private categoryRepository: Repository<HomeRecommendCategory>,
    @InjectRepository(HomeRecommendItem)
    private itemRepository: Repository<HomeRecommendItem>,
    @InjectRepository(CourseCategory)
    private courseCategoryRepository: Repository<CourseCategory>,
  ) {}

  /**
   * 获取推荐版块列表
   */
  async getCategories() {
    const categories = await this.categoryRepository.find({
      order: { sort: 'ASC' },
      relations: ['items'],
    });

    const bindCategoryIds = categories
      .filter((category) => category.type === 'category' && category.bind_category_id)
      .map((category) => category.bind_category_id as number);
    const childCounts = new Map<number, number>();
    if (bindCategoryIds.length > 0) {
      const rows = await this.courseCategoryRepository
        .createQueryBuilder('category')
        .select('category.parent_id', 'parent_id')
        .addSelect('COUNT(category.id)', 'count')
        .where('category.parent_id IN (:...ids)', { ids: bindCategoryIds })
        .groupBy('category.parent_id')
        .getRawMany();
      rows.forEach((row) => childCounts.set(Number(row.parent_id), Number(row.count) || 0));
    }

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      type: category.type || 'course',
      bind_category_id: category.bind_category_id || null,
      sort: category.sort,
      status: category.status,
      item_count:
        category.type === 'category'
          ? childCounts.get(category.bind_category_id || 0) || 0
          : category.items?.length || 0,
    }));
  }

  /**
   * 获取版块详情（包含题库列表）
   */
  async getCategoryDetail(id: number) {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: ['items'],
    });

    if (!category) {
      throw new NotFoundException('版块不存在');
    }

    // 获取题库详细信息
    const items = await this.itemRepository.find({
      where: { category_id: id },
      order: { sort: 'ASC' },
    });

    return {
      id: category.id,
      name: category.name,
      type: category.type || 'course',
      bind_category_id: category.bind_category_id || null,
      sort: category.sort,
      status: category.status,
      items: items.map((item) => ({
        id: item.id,
        category_id: item.category_id,
        course_id: item.course_id,
        sort: item.sort,
      })),
    };
  }

  /**
   * 创建版块
   */
  async createCategory(dto: CreateCategoryDto) {
    await this.validateCategoryBlock(dto.type || 'course', dto.bind_category_id);
    const category = this.categoryRepository.create({
      ...dto,
      type: dto.type || 'course',
      bind_category_id: dto.type === 'category' ? dto.bind_category_id : null,
      status: dto.status !== undefined ? dto.status : 1, // 默认 status = 1 (显示)
    });
    await this.categoryRepository.save(category);
    return category;
  }

  /**
   * 更新版块
   */
  async updateCategory(id: number, dto: UpdateCategoryDto) {
    const category = await this.categoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new NotFoundException('版块不存在');
    }

    const nextType = dto.type || category.type || 'course';
    const nextBindCategoryId =
      nextType === 'category'
        ? dto.bind_category_id !== undefined
          ? dto.bind_category_id
          : category.bind_category_id
        : null;
    await this.validateCategoryBlock(nextType, nextBindCategoryId);

    Object.assign(category, {
      ...dto,
      type: nextType,
      bind_category_id: nextBindCategoryId,
    });
    await this.categoryRepository.save(category);

    return category;
  }

  /**
   * 删除版块
   */
  async deleteCategory(id: number) {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: ['items'],
    });

    if (!category) {
      throw new NotFoundException('版块不存在');
    }

    // 检查是否有关联题库
    if (category.items && category.items.length > 0) {
      throw new BadRequestException('该版块下还有关联题库，无法删除');
    }

    await this.categoryRepository.remove(category);
    return { success: true };
  }

  /**
   * 添加题库到版块
   */
  async addItem(dto: AddItemDto) {
    const category = await this.categoryRepository.findOne({ where: { id: dto.category_id } });
    if (!category) {
      throw new NotFoundException('版块不存在');
    }
    if (category.type === 'category') {
      throw new BadRequestException('分类板块不支持手动添加课程');
    }
    const item = this.itemRepository.create(dto);
    await this.itemRepository.save(item);
    return item;
  }

  /**
   * 移除版块内的题库
   */
  async removeItem(id: number) {
    const item = await this.itemRepository.findOne({ where: { id } });

    if (!item) {
      throw new NotFoundException('记录不存在');
    }

    await this.itemRepository.remove(item);
    return { success: true };
  }

  /**
   * 调整版块内题库排序
   */
  async updateItemSort(dto: UpdateItemSortDto) {
    const promises = dto.items.map((item) =>
      this.itemRepository.update({ id: item.id }, { sort: item.sort }),
    );

    await Promise.all(promises);
    return { success: true };
  }

  private async validateCategoryBlock(type: 'course' | 'category', bindCategoryId?: number | null) {
    if (type !== 'category') return;
    if (!bindCategoryId) {
      throw new BadRequestException('分类板块必须绑定一级分类');
    }
    const bindCategory = await this.courseCategoryRepository.findOne({ where: { id: bindCategoryId } });
    if (!bindCategory) {
      throw new BadRequestException('绑定的一级分类不存在');
    }
    if (bindCategory.parent_id) {
      throw new BadRequestException('分类板块只能绑定一级分类');
    }
  }

}
