import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HomeRecommendCategory } from '../../database/entities/home-recommend-category.entity';
import { HomeRecommendItem } from '../../database/entities/home-recommend-item.entity';
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
  ) {}

  /**
   * 获取推荐版块列表
   */
  async getCategories() {
    const categories = await this.categoryRepository.find({
      order: { sort: 'ASC' },
      relations: ['items'],
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      sort: category.sort,
      status: category.status,
      item_count: category.items?.length || 0,
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
      sort: category.sort,
      status: category.status,
      items: items.map((item) => ({
        id: item.id,
        category_id: item.category_id,
        subject_id: item.subject_id,
        sort: item.sort,
      })),
    };
  }

  /**
   * 创建版块
   */
  async createCategory(dto: CreateCategoryDto) {
    const category = this.categoryRepository.create({
      ...dto,
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

    Object.assign(category, dto);
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

}

