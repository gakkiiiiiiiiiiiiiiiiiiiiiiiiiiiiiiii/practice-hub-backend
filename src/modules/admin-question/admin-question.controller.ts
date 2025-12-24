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
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminQuestionService } from './admin-question.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ImportQuestionDto } from './dto/import-question.dto';
import { QuestionType } from '../../database/entities/question.entity';

@ApiTags('管理后台-题目管理')
@Controller('admin/questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@UseFilters(HttpExceptionFilter)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class AdminQuestionController {
  constructor(private readonly adminQuestionService: AdminQuestionService) {}

  @Post()
  @ApiOperation({ summary: '新增/编辑题目' })
  async saveQuestion(@Body() dto: CreateQuestionDto) {
    const result = await this.adminQuestionService.saveQuestion(dto);
    return CommonResponseDto.success(result);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新题目' })
  async updateQuestion(@Param('id') id: number, @Body() dto: UpdateQuestionDto) {
    const result = await this.adminQuestionService.saveQuestion(dto, +id);
    return CommonResponseDto.success(result);
  }

  @Get()
  @ApiOperation({ summary: '题目列表' })
  async getQuestionList(
    @Query('course_id') courseId?: number,
    @Query('chapter_id') chapterId?: number,
    @Query('type') type?: QuestionType,
  ) {
    const result = await this.adminQuestionService.getQuestionList(
      courseId ? +courseId : undefined,
      chapterId ? +chapterId : undefined,
      type,
    );
    return CommonResponseDto.success(result);
  }

  @Post('import')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ImportQuestionDto })
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '批量导入题目' })
  async importQuestions(
    @UploadedFile() file: Express.Multer.File,
    @Body('chapterId') chapterId: string,
  ) {
    if (!file) {
      throw new BadRequestException('文件不能为空');
    }
    const dto: ImportQuestionDto = {
      chapterId: +chapterId,
      file,
    };
    const result = await this.adminQuestionService.importQuestions(dto);
    return CommonResponseDto.success(result);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取题目详情' })
  async getQuestionDetail(@Param('id') id: number) {
    const result = await this.adminQuestionService.getQuestionDetail(+id);
    return CommonResponseDto.success(result);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除题目' })
  async deleteQuestion(@Param('id') id: number) {
    const result = await this.adminQuestionService.deleteQuestion(+id);
    return CommonResponseDto.success(result);
  }
}

