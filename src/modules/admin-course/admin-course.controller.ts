import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UseFilters,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminCourseService } from './admin-course.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpdateRecommendationsDto } from '../course/dto/update-recommendations.dto';

@ApiTags('管理后台-课程管理')
@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@UseFilters(HttpExceptionFilter)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class AdminCourseController {
  constructor(private readonly adminCourseService: AdminCourseService) {}

  @Post()
  @ApiOperation({ summary: '新增课程' })
  async createCourse(@Body() dto: CreateCourseDto) {
    const result = await this.adminCourseService.saveCourse(dto);
    return CommonResponseDto.success(result);
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑课程' })
  async updateCourse(@Param('id') id: number, @Body() dto: UpdateCourseDto) {
    const result = await this.adminCourseService.saveCourse(dto, +id);
    return CommonResponseDto.success(result);
  }

  @Get()
  @ApiOperation({ summary: '获取课程列表' })
  async getCourseList() {
    const result = await this.adminCourseService.getCourseList();
    return CommonResponseDto.success(result);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取课程详情' })
  async getCourseDetail(@Param('id') id: number) {
    const result = await this.adminCourseService.getCourseDetail(+id);
    return CommonResponseDto.success(result);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除课程' })
  async deleteCourse(@Param('id') id: number) {
    const result = await this.adminCourseService.deleteCourse(+id);
    return CommonResponseDto.success(result);
  }

  @Get('recommendations')
  @ApiOperation({ summary: '获取相关推荐配置' })
  async getRecommendations(@Query('courseId') courseId?: string | number) {
    // 处理 courseId：如果为空、undefined 或无效，则传递 null
    let parsedCourseId: number | null = null;
    if (courseId !== undefined && courseId !== null && courseId !== '') {
      const numId = typeof courseId === 'string' ? parseInt(courseId, 10) : courseId;
      if (!isNaN(numId) && numId > 0) {
        parsedCourseId = numId;
      }
    }
    const result = await this.adminCourseService.getRecommendations(parsedCourseId);
    return CommonResponseDto.success(result);
  }

  @Put('recommendations')
  @ApiOperation({ summary: '更新相关推荐配置' })
  async updateRecommendations(@Body() dto: UpdateRecommendationsDto) {
    const result = await this.adminCourseService.updateRecommendations(dto);
    return CommonResponseDto.success(result);
  }
}

