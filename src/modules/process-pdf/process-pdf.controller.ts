import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { readFile } from 'fs/promises';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { ProcessPdfService } from './process-pdf.service';
import { SiliconFlowOcrService } from './silicon-flow-ocr.service';

@ApiTags('管理后台-PDF题目提取')
@Controller('admin/process-pdf')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class ProcessPdfController {
  constructor(
    private readonly processPdfService: ProcessPdfService,
    private readonly siliconFlowOcr: SiliconFlowOcrService,
  ) {}

  @Post('extract')
  @ApiOperation({ summary: '上传 PDF 并提取题目（pdf-parse 本地解析）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        pdf: {
          type: 'string',
          format: 'binary',
          description: 'PDF 文件（建议单次不超过数十页，避免超时）',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('pdf', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB，与 BODY_LIMIT 一致；若仍 413 需在网关/云托管侧提高限制
      fileFilter: (_req, file, cb) => {
        if (!file.originalname?.toLowerCase().endsWith('.pdf')) {
          return cb(new BadRequestException('仅支持 PDF 文件'), false);
        }
        cb(null, true);
      },
    }),
  )
  async extract(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传 PDF 文件（表单字段 pdf）');
    }
    const questions = await this.processPdfService.extractQuestions(file);
    return CommonResponseDto.success({
      count: questions.length,
      data: questions,
    });
  }

  @Post('extract-doc')
  @ApiOperation({ summary: '上传 Word 并提取题目（.docx/.doc，mammoth 解析）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        doc: {
          type: 'string',
          format: 'binary',
          description: 'Word 文件（.docx 或 .doc）',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('doc', {
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        if (!name.endsWith('.docx') && !name.endsWith('.doc')) {
          return cb(new BadRequestException('仅支持 .docx 或 .doc 文件'), false);
        }
        cb(null, true);
      },
    }),
  )
  async extractDoc(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传 Word 文件（表单字段 doc）');
    }
    const questions = await this.processPdfService.extractQuestionsFromWord(file);
    return CommonResponseDto.success({
      count: questions.length,
      data: questions,
    });
  }

  @Post('ocr-image')
  @ApiOperation({ summary: '单张图片 OCR 识别（题干图片转文字）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: '图片文件（支持 jpg、png、gif、webp）',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        if (!file.mimetype || !allowed.includes(file.mimetype)) {
          return cb(new BadRequestException('仅支持 jpg、png、gif、webp 图片'), false);
        }
        cb(null, true);
      },
    }),
  )
  async ocrImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传图片文件（表单字段 image）');
    }
    const fileWithBuffer = file as Express.Multer.File & { buffer?: Buffer };
    const buffer = fileWithBuffer.buffer ?? (file.path ? await readFile(file.path) : null);
    if (!buffer) {
      throw new BadRequestException('无法读取文件内容');
    }
    const base64 = buffer.toString('base64');
    const text = await this.siliconFlowOcr.ocrImageBase64(base64);
    return CommonResponseDto.success({ text });
  }
}
