import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { HomeRecommendCategory } from '../../database/entities/home-recommend-category.entity';
import { HomeRecommendItem } from '../../database/entities/home-recommend-item.entity';
import { RecommendService } from './recommend.service';

@ApiTags('小程序-首页推荐')
@Controller('app/recommend')
export class AppRecommendController {
  constructor(
    private readonly recommendService: RecommendService,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(HomeRecommendCategory)
    private categoryRepository: Repository<HomeRecommendCategory>,
    @InjectRepository(HomeRecommendItem)
    private itemRepository: Repository<HomeRecommendItem>,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: '获取推荐版块列表（包含题库详情）' })
  async getCategories() {
    try {
      // 直接查询所有分类，然后过滤
      const allCategories = await this.categoryRepository.find({
        order: { sort: 'ASC' },
      });
      console.log('直接查询所有分类数量:', allCategories?.length || 0);
      if (allCategories && allCategories.length > 0) {
        console.log('所有分类详情:', JSON.stringify(allCategories.map(c => ({ id: c.id, name: c.name, status: c.status })), null, 2));
      } else {
        console.log('数据库中没有任何分类数据！');
        return CommonResponseDto.success([]);
      }

      // 过滤出启用的分类（status = 1）
      // 注意：status 可能是数字 1 或字符串 '1'，需要兼容处理
      const categories = allCategories.filter(cat => {
        const status = cat.status;
        return Number(status) === 1;
      });
      console.log('启用的分类数量 (status=1):', categories?.length || 0);
      console.log('启用的分类详情:', JSON.stringify(categories.map(c => ({ id: c.id, name: c.name, status: c.status })), null, 2));

      if (categories.length === 0) {
        console.log('没有找到启用的推荐分类（status=1）');
        console.log('提示：请在管理后台将分类状态设置为"显示"（status=1）');
        console.log('当前所有分类的 status 值:', allCategories.map(c => `ID:${c.id} status:${c.status} (type:${typeof c.status})`));
        return CommonResponseDto.success([]);
      }

      const result = [];

      for (const category of categories) {
        // 获取该分类下的所有推荐题库
        const items = await this.itemRepository.find({
          where: { category_id: category.id },
          order: { sort: 'ASC' },
        });

        console.log(`分类 ${category.name} (ID: ${category.id}) 下的题库数量:`, items?.length || 0);

        // 如果没有题库，仍然返回分类但 items 为空数组
        if (!items || items.length === 0) {
          result.push({
            id: category.id,
            name: category.name,
            items: [],
          });
          continue;
        }

        // 获取课程详情
        const courseIds = items.map((item) => item.course_id);
        const courses = await this.courseRepository.find({
          where: { id: In(courseIds) },
        });

        console.log(`找到的课程详情数量:`, courses?.length || 0);

        // 按排序组装，保持 items 的顺序
        const sortedCourses = items
          .map((item) => {
            const course = courses.find((c) => c.id === item.course_id);
            return course ? { ...course } : null;
          })
          .filter(Boolean);

        result.push({
          id: category.id,
          name: category.name,
          items: sortedCourses,
        });
      }

      console.log('最终返回的分类数量:', result.length);
      return CommonResponseDto.success(result);
    } catch (error) {
      console.error('获取推荐分类失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有分类及其题库（辅助方法）
   */
  private async getAllCategoriesWithItems(categories: HomeRecommendCategory[]) {
    const result = [];

    for (const category of categories) {
      // 获取该分类下的所有推荐题库
      const items = await this.itemRepository.find({
        where: { category_id: category.id },
        order: { sort: 'ASC' },
      });

      // 如果没有题库，仍然返回分类但 items 为空数组
      if (!items || items.length === 0) {
        result.push({
          id: category.id,
          name: category.name,
          items: [],
        });
        continue;
      }

      // 获取课程详情
      const courseIds = items.map((item) => item.course_id);
      const courses = await this.courseRepository.find({
        where: { id: In(courseIds) },
      });

      // 按排序组装，保持 items 的顺序
      const sortedCourses = items
        .map((item) => {
          const course = courses.find((c) => c.id === item.course_id);
          return course ? { ...course } : null;
        })
        .filter(Boolean);

      result.push({
        id: category.id,
        name: category.name,
        items: sortedCourses,
      });
    }

    return result;
  }
}

