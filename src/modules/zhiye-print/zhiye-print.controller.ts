import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { QuoteZhiyePrintDraftDto } from './dto/quote-zhiye-print-draft.dto';
import { UpdateZhiyePrintDraftDto } from './dto/update-zhiye-print-draft.dto';
import { ZhiyePrintService } from './zhiye-print.service';
import { ZhiyeAppGuard } from './zhiye-app.guard';

@ApiTags('知页打印')
@Controller('app/zhiye-print')
@UseGuards(JwtAuthGuard, ZhiyeAppGuard)
@ApiBearerAuth()
export class ZhiyePrintController {
  constructor(private readonly zhiyePrintService: ZhiyePrintService) {}

  @Post('drafts')
  @ApiOperation({ summary: '上传 PDF 并创建本人打印草稿' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string', maxLength: 120 },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      const isPdf = file.mimetype === 'application/pdf' ||
        String(file.originalname || '').toLowerCase().endsWith('.pdf');
      callback(isPdf ? null : new BadRequestException('仅支持 PDF 文件'), isPdf);
    },
  }))
  async createDraft(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title?: string,
  ) {
    if (!file) throw new BadRequestException('请选择 PDF 文件');
    const result = await this.zhiyePrintService.createDraftFromPdfBuffer(
      Number(user.userId),
      file.buffer,
      file.originalname,
      title,
    );
    return CommonResponseDto.success(result);
  }

  @Get('drafts')
  @ApiOperation({ summary: '获取本人打印草稿列表' })
  async listDrafts(@CurrentUser() user: any) {
    return CommonResponseDto.success(
      await this.zhiyePrintService.listDrafts(Number(user.userId)),
    );
  }

  @Get('drafts/:id')
  @ApiOperation({ summary: '获取本人打印草稿详情' })
  async getDraft(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return CommonResponseDto.success(
      await this.zhiyePrintService.getDraft(Number(user.userId), id),
    );
  }

  @Get('drafts/:id/preview')
  @ApiOperation({ summary: '获取本人打印草稿的短期预览地址' })
  async getDraftPreview(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return CommonResponseDto.success(
      await this.zhiyePrintService.getDraftPreview(Number(user.userId), id),
    );
  }

  @Put('drafts/:id')
  @ApiOperation({ summary: '设置打印份数和收货地址' })
  async updateDraft(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateZhiyePrintDraftDto,
  ) {
    return CommonResponseDto.success(
      await this.zhiyePrintService.updateDraft(Number(user.userId), id, dto),
    );
  }

  @Post('drafts/:id/quote')
  @ApiOperation({ summary: '显式推进一次云打印报价' })
  async quoteDraft(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuoteZhiyePrintDraftDto,
  ) {
    return CommonResponseDto.success(
      await this.zhiyePrintService.quoteDraft(Number(user.userId), id, dto),
    );
  }
}
