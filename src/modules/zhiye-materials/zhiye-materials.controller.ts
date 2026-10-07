import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZhiyeAppGuard } from '../zhiye-print/zhiye-app.guard';
import { ZhiyeMaterialsService } from './zhiye-materials.service';

@ApiTags('知页试卷资料')
@Controller('app/zhiye-materials')
export class ZhiyeMaterialsController {
  constructor(private readonly zhiyeMaterialsService: ZhiyeMaterialsService) {}

  @Get(':id')
  @ApiOperation({ summary: '获取公开试卷的安全元数据' })
  async getDetails(@Param('id') id: string) {
    return CommonResponseDto.success(await this.zhiyeMaterialsService.getDetails(id));
  }

  @Get(':id/preview')
  @ApiOperation({ summary: '公开预览试卷的实际前三页 PDF' })
  @ApiProduces('application/pdf')
  async getPreview(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const preview = await this.zhiyeMaterialsService.getPreview(id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(preview.buffer.length));
    response.setHeader('Content-Disposition', `inline; filename=\"${preview.fileName}\"`);
    response.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    response.setHeader('ETag', preview.etag);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Preview-Page-Count', String(preview.previewPageCount));
    response.setHeader('X-Source-Page-Count', String(preview.pageCount));
    return new StreamableFile(preview.buffer);
  }

  @Post(':id/print-draft')
  @UseGuards(JwtAuthGuard, ZhiyeAppGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '使用完整原稿创建本人云打印草稿' })
  async createPrintDraft(@CurrentUser() user: any, @Param('id') id: string) {
    return CommonResponseDto.success(
      await this.zhiyeMaterialsService.createPrintDraft(Number(user.userId), id),
    );
  }
}
