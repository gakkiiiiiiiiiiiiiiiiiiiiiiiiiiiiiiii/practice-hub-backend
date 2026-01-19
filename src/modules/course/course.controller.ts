import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CourseService } from './course.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('课程')
@Controller('app/courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Get()
  @ApiOperation({ summary: '所有课程列表' })
  async getAllCourses(@Query('keyword') keyword?: string) {
    const result = await this.courseService.getAllCourses(keyword);
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

