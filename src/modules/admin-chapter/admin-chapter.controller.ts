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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminChapterService } from './admin-chapter.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';

@ApiTags('管理后台-章节管理')
@Controller('admin/chapters')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class AdminChapterController {
  constructor(private readonly adminChapterService: AdminChapterService) {}

  @Post()
  @ApiOperation({ summary: '新增章节' })
  async createChapter(@Body() dto: CreateChapterDto) {
    const result = await this.adminChapterService.saveChapter(dto);
    return CommonResponseDto.success(result);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新章节' })
  async updateChapter(@Param('id') id: number, @Body() dto: UpdateChapterDto) {
    const result = await this.adminChapterService.saveChapter(dto, +id);
    return CommonResponseDto.success(result);
  }

  @Get()
  @ApiOperation({ summary: '获取章节列表' })
  async getChapterList(@Query('subjectId') subjectId?: number, @Query('subject_id') subject_id?: number) {
    // 兼容两种参数名：subjectId 和 subject_id
    const id = subjectId || subject_id;
    const result = await this.adminChapterService.getChapterList(
      id ? +id : undefined,
    );
    return CommonResponseDto.success(result);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除章节' })
  async deleteChapter(@Param('id') id: number) {
    await this.adminChapterService.deleteChapter(+id);
    return CommonResponseDto.success(null, '删除成功');
  }
}

