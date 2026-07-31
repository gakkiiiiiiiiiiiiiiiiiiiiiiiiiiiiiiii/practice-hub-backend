import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Order } from '../../database/entities/order.entity';
import { UserCategoryBundleAccess } from '../../database/entities/user-category-bundle-access.entity';

@Injectable()
export class CategoryBundleAccessService {
  private readonly logger = new Logger(CategoryBundleAccessService.name);

  constructor(
    @InjectRepository(UserCategoryBundleAccess)
    private accessRepository: Repository<UserCategoryBundleAccess>,
    @InjectRepository(CourseCategory)
    private categoryRepository: Repository<CourseCategory>,
  ) {}

  async grantOrderAccess(order: Order) {
    const categoryId = Number(order.pay_payload?.category_bundle?.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throw new Error(`类目订单 ${order.order_no} 缺少有效的 category_id`);
    }

    const access = this.accessRepository.create({
      user_id: order.user_id,
      category_id: categoryId,
      order_id: order.id,
    });
    await this.accessRepository.upsert(access, ['order_id']);
    this.logger.log(
      `已授予类目套餐权限 - 用户: ${order.user_id}, 类目: ${categoryId}, 订单: ${order.id}`,
    );
    return access;
  }

  async revokeOrderAccess(orderId: number) {
    await this.accessRepository.delete({ order_id: orderId });
  }

  async userHasCategoryAccess(userId: number, categoryId: number) {
    return (
      (await this.accessRepository.count({
        where: { user_id: userId, category_id: categoryId },
      })) > 0
    );
  }

  async userHasCourseAccess(userId: number, course: Course) {
    const accessMap = await this.batchUserHasCourseAccess(userId, [course]);
    return accessMap.has(course.id);
  }

  async batchUserHasCourseAccess(userId: number, courses: Course[]) {
    const result = new Map<number, true>();
    if (!userId || courses.length === 0) {
      return result;
    }

    const accesses = await this.accessRepository.find({
      where: { user_id: userId },
    });
    if (accesses.length === 0) {
      return result;
    }

    const categoryIds = Array.from(
      new Set(accesses.map((access) => access.category_id)),
    );
    const categories = await this.categoryRepository.find({
      where: { id: In(categoryIds) },
    });
    const parentIds = Array.from(
      new Set(
        categories
          .map((category) => category.parent_id)
          .filter((id): id is number => id !== null),
      ),
    );
    const parents = parentIds.length
      ? await this.categoryRepository.find({ where: { id: In(parentIds) } })
      : [];
    const parentMap = new Map(
      parents.map((category) => [category.id, category]),
    );

    const scopes = categories.map((category) => ({
      category: category.parent_id
        ? parentMap.get(category.parent_id)?.name?.trim() || ''
        : category.name.trim(),
      subCategory: category.parent_id ? category.name.trim() : null,
    }));

    courses.forEach((course) => {
      const courseCategory = course.category?.trim() || '';
      const courseSubCategory = course.sub_category?.trim() || '';
      const matched = scopes.some(
        (scope) =>
          scope.category === courseCategory &&
          (scope.subCategory === null ||
            scope.subCategory === courseSubCategory),
      );
      if (matched) {
        result.set(course.id, true);
      }
    });

    return result;
  }
}
