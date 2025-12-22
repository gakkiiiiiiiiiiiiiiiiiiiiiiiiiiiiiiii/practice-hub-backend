import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubjectService } from './subject.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';

@ApiTags('题库')
@Controller('app/subjects')
export class SubjectController {
  constructor(private readonly subjectService: SubjectService) {}

  @Get()
  @ApiOperation({ summary: '所有题库列表' })
  async getAllSubjects(@Query('keyword') keyword?: string) {
    const result = await this.subjectService.getAllSubjects(keyword);
    return CommonResponseDto.success(result);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: '题库详情' })
  async getSubjectDetail(
    @Param('id') id: number,
  ) {
    // 注意：这里不强制要求登录，因为需要支持未登录用户查看题库信息
    const result = await this.subjectService.getSubjectDetail(+id);
    return CommonResponseDto.success(result);
  }
}

