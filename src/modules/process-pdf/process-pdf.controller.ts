import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { ProcessPdfService } from './process-pdf.service';

@ApiTags('管理后台-PDF题目提取')
@Controller('admin/process-pdf')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class ProcessPdfController {
  constructor(private readonly processPdfService: ProcessPdfService) {}

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
      limits: { fileSize: 30 * 1024 * 1024 },
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
}
