import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CourseService } from './course.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Course } from '../../database/entities/course.entity';

@ApiTags('课程')
@Controller('app/courses')
export class CourseController {
  constructor(
    private readonly courseService: CourseService,
    @InjectRepository(CourseCategory)
    private courseCategoryRepository: Repository<CourseCategory>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  @Get()
  @ApiOperation({ summary: '所有课程列表' })
  async getAllCourses(
    @Query('keyword') keyword?: string,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const result = await this.courseService.getAllCourses(keyword, category, subCategory, sortBy);
    return CommonResponseDto.success(result);
  }

  @Get(':id/detail')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '课程详情' })
  async getCourseDetail(
    @Param('id') id: number,
    @CurrentUser() user?: any,
  ) {
    // 注意：这里不强制要求登录，因为需要支持未登录用户查看课程信息
    // 但如果用户已登录，会检查权限
    const userId = user?.userId;
    const result = await this.courseService.getCourseDetail(+id, userId);
    return CommonResponseDto.success(result);
  }

  @Get('categories')
  @ApiOperation({ summary: '获取课程分类树（包含课程列表）' })
  async getCourseCategories() {
    try {
      // 查询所有启用的分类
      const categories = await this.courseCategoryRepository.find({
        where: { status: 1 },
        order: { sort: 'ASC', id: 'ASC' },
      });

      if (!categories || categories.length === 0) {
        return CommonResponseDto.success([]);
      }

      // 构建分类树
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

      // 为每个二级分类获取课程列表
      const result = await Promise.all(
        tree.map(async (primaryCategory) => {
          const childrenWithCourses = await Promise.all(
            primaryCategory.children.map(async (subCategory) => {
              // 查询该二级分类下的所有课程
              const courses = await this.courseRepository.find({
                where: { sub_category: subCategory.name },
                order: { sort: 'ASC', id: 'ASC' },
              });

              return {
                ...subCategory,
                courses: courses || [],
              };
            })
          );

          return {
            ...primaryCategory,
            children: childrenWithCourses,
          };
        })
      );

      return CommonResponseDto.success(result);
    } catch (error) {
      console.error('获取课程分类失败:', error);
      throw error;
    }
  }

  @Get('recommendations')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取课程相关推荐' })
  async getRecommendations(@Query('courseId') courseId?: string | number, @CurrentUser() user?: any) {
    // 处理 courseId：如果为空、undefined 或无效，则传递 undefined
    let parsedCourseId: number | undefined = undefined;
    
    if (courseId !== undefined && courseId !== null && courseId !== '') {
      const numId = typeof courseId === 'string' ? parseInt(courseId, 10) : Number(courseId);
      if (!isNaN(numId) && Number.isFinite(numId) && numId > 0) {
        parsedCourseId = numId;
      }
    }
    
    const userId = user?.userId;
    const result = await this.courseService.getRecommendations(parsedCourseId, userId);
    return CommonResponseDto.success(result);
  }
}

