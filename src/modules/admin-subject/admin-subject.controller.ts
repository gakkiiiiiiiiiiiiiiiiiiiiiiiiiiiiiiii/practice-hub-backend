import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminSubjectService } from './admin-subject.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@ApiTags('管理后台-题库管理')
@Controller('admin/subjects')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class AdminSubjectController {
  constructor(private readonly adminSubjectService: AdminSubjectService) {}

  @Post()
  @ApiOperation({ summary: '新增/编辑科目' })
  async saveSubject(@Body() dto: CreateSubjectDto) {
    const result = await this.adminSubjectService.saveSubject(dto);
    return CommonResponseDto.success(result);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新科目' })
  async updateSubject(@Param('id') id: number, @Body() dto: UpdateSubjectDto) {
    const result = await this.adminSubjectService.saveSubject(dto, +id);
    return CommonResponseDto.success(result);
  }

  @Get()
  @ApiOperation({ summary: '获取科目列表' })
  async getSubjectList() {
    const result = await this.adminSubjectService.getSubjectList();
    return CommonResponseDto.success(result);
  }
}

