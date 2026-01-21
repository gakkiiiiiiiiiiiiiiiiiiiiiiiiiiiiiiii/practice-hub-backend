import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { HomeRecommendCategory } from '../../database/entities/home-recommend-category.entity';
import { HomeRecommendItem } from '../../database/entities/home-recommend-item.entity';

@ApiTags('小程序-首页推荐')
@Controller('app/recommend')
export class AppRecommendController {
  constructor(
    @InjectRepository(HomeRecommendCategory)
    private categoryRepository: Repository<HomeRecommendCategory>,
    @InjectRepository(HomeRecommendItem)
    private itemRepository: Repository<HomeRecommendItem>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: '获取首页推荐版块列表（包含课程详情）' })
  async getCategories() {
    try {
      // 查询所有启用的推荐版块
      const categories = await this.categoryRepository.find({
        where: { status: 1 },
        order: { sort: 'ASC' },
      });

      if (!categories || categories.length === 0) {
        return CommonResponseDto.success([]);
      }

      const result = [];

      for (const category of categories) {
        // 获取该版块下的所有推荐项
        const items = await this.itemRepository.find({
          where: { category_id: category.id },
          order: { sort: 'ASC' },
        });

        if (!items || items.length === 0) {
          // 如果版块下没有课程，仍然返回版块但 items 为空数组
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

        // 按 items 的排序组装课程列表
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

      return CommonResponseDto.success(result);
    } catch (error) {
      console.error('获取推荐版块失败:', error);
      throw error;
    }
  }

}

