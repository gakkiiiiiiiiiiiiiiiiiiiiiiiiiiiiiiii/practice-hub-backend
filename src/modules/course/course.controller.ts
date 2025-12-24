import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CourseService } from './course.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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
  @ApiOperation({ summary: '课程详情' })
  async getCourseDetail(
    @Param('id') id: number,
    @CurrentUser() user?: any,
  ) {
    // 注意：这里不强制要求登录，因为需要支持未登录用户查看课程信息
    const userId = user?.userId;
    const result = await this.courseService.getCourseDetail(+id, userId);
    return CommonResponseDto.success(result);
  }
}

