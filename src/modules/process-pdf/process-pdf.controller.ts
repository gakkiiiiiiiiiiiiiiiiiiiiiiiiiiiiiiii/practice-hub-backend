import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  UseGuards,
  Body,
  Param,
  Query,
  Logger,
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
import { PdfExtractQueueService } from './pdf-extract-queue.service';
import { UploadService } from '../upload/upload.service';

@ApiTags('管理后台-PDF题目提取')
@Controller('admin/process-pdf')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class ProcessPdfController {
  private readonly logger = new Logger(ProcessPdfController.name);

  constructor(
    private readonly processPdfService: ProcessPdfService,
    private readonly siliconFlowOcr: SiliconFlowOcrService,
    private readonly pdfExtractQueue: PdfExtractQueueService,
    private readonly uploadService: UploadService,
  ) {}

  @Post('extract')
  @ApiOperation({ summary: '提交 PDF 提取任务（异步队列），立即返回 taskId，通过 GET /extract/task/:taskId 轮询结果' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        pdf: {
          type: 'string',
          format: 'binary',
          description: 'PDF 文件',
        },
        forceOcr: {
          type: 'string',
          description: '传 "1" 或 "true" 时强制转为图片后 OCR',
        },
        direct: {
          type: 'string',
          description: '传 "1" 或 "true" 时直接上传 PDF 进行解析，不先写入对象存储',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('pdf', {
      fileFilter: (_req, file, cb) => {
        if (!file.originalname?.toLowerCase().endsWith('.pdf')) {
          return cb(new BadRequestException('仅支持 PDF 文件'), false);
        }
        cb(null, true);
      },
    }),
  )
  async extract(
    @UploadedFile() file: Express.Multer.File,
    @Body('forceOcr') forceOcr?: string,
    @Body('direct') direct?: string,
  ) {
    if (!file) {
      throw new BadRequestException('请上传 PDF 文件（表单字段 pdf）');
    }
    const fileName = file.originalname || 'upload.pdf';
    const useForceOcr = forceOcr === '1' || forceOcr === 'true' || forceOcr === 'yes';
    // 未传 direct 时默认直接上传解析（不先写对象存储）；识别不到文本时自动走 OCR
    const useDirect =
      direct === undefined ||
      direct === '' ||
      direct === '1' ||
      direct === 'true' ||
      direct === 'yes';
    this.logger.log(
      `[PDF提取] 收到上传: fileName=${fileName}, size=${file.size}, forceOcr=${useForceOcr}, direct=${useDirect}`,
    );
    if (useDirect) {
      const { taskId } = await this.pdfExtractQueue.submit(file, useForceOcr);
      this.logger.log(`[PDF提取] 直接解析任务已提交: taskId=${taskId}, fileName=${fileName}`);
      return CommonResponseDto.success({ taskId, fileName });
    }
    const url = await this.uploadService.uploadPdf(file);
    this.logger.log(`[PDF提取] 已上传到存储: fileName=${fileName}, url=${url}`);
    const { taskId } = await this.pdfExtractQueue.submitByUrl(url, fileName, useForceOcr);
    this.logger.log(`[PDF提取] 任务已提交: taskId=${taskId}, fileName=${fileName}`);
    return CommonResponseDto.success({ taskId, fileName });
  }

  @Get('extract/tasks')
  @ApiOperation({ summary: '获取近期 PDF 提取任务列表（用于弹窗表格）' })
  async getExtractTasks(@Query('limit') limit?: string) {
    const n = Math.min(parseInt(limit || '50', 10) || 50, 100);
    const tasks = this.pdfExtractQueue.getRecentTasks(n);
    return CommonResponseDto.success(tasks);
  }

  @Get('extract/task/:taskId')
  @ApiOperation({ summary: '查询 PDF 提取任务状态与结果' })
  async getExtractTask(@Param('taskId') taskId: string) {
    const task = this.pdfExtractQueue.getTask(taskId);
    if (!task) {
      this.logger.warn(`[PDF提取] 查询任务不存在: taskId=${taskId}`);
      throw new NotFoundException('任务不存在或已过期');
    }
    return CommonResponseDto.success({
      taskId: task.taskId,
      status: task.status,
      fileName: task.fileName,
      progress: task.progress,
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
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
  @ApiOperation({ summary: '单张图片 OCR 识别（题干图片转文字），请求体为 base64' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          description: '图片 base64 字符串（可为纯 base64 或 data:image/xxx;base64,xxx 格式）',
        },
      },
    },
  })
  async ocrImage(@Body() body: { image: string }) {
    const raw = body?.image;
    if (!raw || typeof raw !== 'string') {
      throw new BadRequestException('请传入 image 字段（图片 base64 数据）');
    }
    let base64 = raw.trim();
    if (base64.startsWith('data:')) {
      const comma = base64.indexOf(',');
      if (comma !== -1) base64 = base64.slice(comma + 1);
    }
    if (!base64) {
      throw new BadRequestException('图片 base64 数据为空');
    }
    const text = await this.siliconFlowOcr.ocrImageBase64(base64);
    return CommonResponseDto.success({ text });
  }
}
