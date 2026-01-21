import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { RecommendService } from './recommend.service';

@ApiTags('小程序-首页推荐')
@Controller('app/recommend')
export class AppRecommendController {
  constructor(
    private readonly recommendService: RecommendService,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: '获取推荐版块列表（包含题库详情）' })
  async getCategories() {
    try {
      // 查询所有有分类信息的课程
      const courses = await this.courseRepository.find({
        where: [
          { category: Not(IsNull()) },
        ],
        order: { sort: 'ASC', id: 'ASC' },
      });

      if (!courses || courses.length === 0) {
        return CommonResponseDto.success([]);
      }

      // 按一级分类分组
      const categoryMap = new Map<string, Map<string, any[]>>();

      for (const course of courses) {
        const category = course.category || '未分类';
        const subCategory = course.sub_category || '默认';

        if (!categoryMap.has(category)) {
          categoryMap.set(category, new Map());
        }

        const subCategoryMap = categoryMap.get(category);
        if (!subCategoryMap.has(subCategory)) {
          subCategoryMap.set(subCategory, []);
        }

        subCategoryMap.get(subCategory).push(course);
      }

      // 转换为目标结构
      const result = Array.from(categoryMap.entries()).map(([categoryName, subCategoryMap]) => {
        const subCategories = Array.from(subCategoryMap.entries()).map(([subCategoryName, courses]) => ({
          name: subCategoryName,
          courses: courses,
        }));

        return {
          name: categoryName,
          subCategories: subCategories,
        };
      });

      return CommonResponseDto.success(result);
    } catch (error) {
      console.error('获取推荐分类失败:', error);
      throw error;
    }
  }

}

