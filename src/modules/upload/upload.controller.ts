import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Req,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import * as fs from 'fs';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('文件上传')
@Controller('admin/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN, AdminRole.CONTENT_ADMIN)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @ApiOperation({ summary: '上传图片（使用微信云托管对象存储）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '图片文件（支持 jpg、png、gif、webp）',
        },
        openid: {
          type: 'string',
          description: '用户openid（可选，管理端上传时可不传）',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('文件不能为空');
    }

    // 从请求体中获取 openid（multipart/form-data）
    const openid = (req.body?.openid as string) || '';
    
    // 管理端上传时 openid 为空字符串，小程序端上传时传入用户 openid
    const imageUrl = await this.uploadService.uploadImage(file, 'images', openid);
    return CommonResponseDto.success({
      url: imageUrl,
      imageUrl, // 兼容前端可能使用的字段名
    });
  }

  @Post('course-file-upload-url')
  @ApiOperation({ summary: '获取课程文件直传 COS 凭证（前端直传，绕过 413）' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fileName'],
      properties: {
        fileName: { type: 'string', description: '原始文件名，如 xxx.pdf' },
      },
    },
  })
  async getCourseFileUploadUrl(@Body() body: { fileName: string }) {
    const fileName = body?.fileName?.trim();
    if (!fileName) {
      throw new BadRequestException('请传入 fileName');
    }
    const ext = fileName.toLowerCase().endsWith('.pdf') ? '.pdf' : fileName.toLowerCase().endsWith('.docx') ? '.docx' : fileName.toLowerCase().endsWith('.doc') ? '.doc' : '';
    if (!['.pdf', '.doc', '.docx'].includes(ext)) {
      throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
    }
    const path = `course-files/${Date.now()}-${Math.random().toString(36).slice(2, 12)}${ext}`;
    const credentials = await this.uploadService.getCourseFileUploadUrl(path);
    return CommonResponseDto.success({
      ...credentials,
      fileName,
      fileType: ext.slice(1),
    });
  }

  @Post('course-file-chunk')
  @ApiOperation({ summary: '上传课程文件的一个分片（大文件分片上传）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['uploadId', 'chunkIndex', 'totalChunks', 'fileName'],
      properties: {
        chunk: { type: 'string', format: 'binary', description: '分片二进制' },
        uploadId: { type: 'string', description: '本次上传任务 ID（前端生成 UUID）' },
        chunkIndex: { type: 'number', description: '当前分片下标，从 0 开始' },
        totalChunks: { type: 'number', description: '总分片数' },
        fileName: { type: 'string', description: '原始文件名，如 xxx.pdf' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('chunk'))
  async uploadCourseFileChunk(
    @UploadedFile() chunk: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!chunk?.buffer && !chunk?.path) {
      throw new BadRequestException('分片不能为空');
    }
    const uploadId = (req.body?.uploadId as string)?.trim();
    const chunkIndex = parseInt(req.body?.chunkIndex as string, 10);
    const totalChunks = parseInt(req.body?.totalChunks as string, 10);
    const fileName = (req.body?.fileName as string)?.trim();
    if (!uploadId || !fileName) {
      throw new BadRequestException('缺少 uploadId 或 fileName');
    }
    if (Number.isNaN(chunkIndex) || Number.isNaN(totalChunks)) {
      throw new BadRequestException('chunkIndex、totalChunks 必须为数字');
    }
    const buffer = (chunk as any).buffer ?? (chunk.path ? await fs.promises.readFile(chunk.path) : null);
    if (!buffer?.length) {
      throw new BadRequestException('无法读取分片内容');
    }
    await this.uploadService.saveCourseFileChunk(uploadId, chunkIndex, totalChunks, buffer);
    return CommonResponseDto.success({ chunkIndex, totalChunks });
  }

  @Post('course-file-merge')
  @ApiOperation({ summary: '合并课程文件分片并返回最终 fileUrl' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['uploadId', 'totalChunks', 'fileName'],
      properties: {
        uploadId: { type: 'string' },
        totalChunks: { type: 'number' },
        fileName: { type: 'string' },
      },
    },
  })
  async mergeCourseFileChunks(
    @Body() body: { uploadId: string; totalChunks: number; fileName: string },
  ) {
    const { uploadId, totalChunks, fileName } = body || {};
    if (!uploadId?.trim() || !(fileName?.trim())) {
      throw new BadRequestException('缺少 uploadId 或 fileName');
    }
    const total = Number(totalChunks);
    if (!Number.isInteger(total) || total < 1 || total > 500) {
      throw new BadRequestException('totalChunks 需为 1～500 的整数');
    }
    const fileUrl = await this.uploadService.mergeCourseFileChunks(uploadId, total, fileName.trim());
    const ext = (fileName.trim().toLowerCase().match(/\.(pdf|doc|docx)$/)?.[1]) || 'pdf';
    return CommonResponseDto.success({
      url: fileUrl,
      fileUrl,
      fileName: fileName.trim(),
      fileType: ext,
    });
  }

  @Post('course-file')
  @ApiOperation({ summary: '上传课程文件（PDF/Word），经后端转发；大文件建议用分片上传' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF 或 Word 文件（.pdf/.doc/.docx）',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        const name = (file.originalname || '').toLowerCase();
        const ok =
          allowed.includes(file.mimetype) ||
          name.endsWith('.pdf') ||
          name.endsWith('.doc') ||
          name.endsWith('.docx');
        if (!ok) {
          return cb(new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadCourseFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择 PDF 或 Word 文件');
    }
    const fileUrl = await this.uploadService.uploadCourseFile(file, '');
    return CommonResponseDto.success({
      url: fileUrl,
      fileUrl,
      fileName: file.originalname,
      fileType: file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : file.originalname.toLowerCase().endsWith('.docx') ? 'docx' : 'doc',
    });
  }
}

// 小程序端图片上传控制器
@ApiTags('文件上传')
@Controller('app/upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AppUploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @ApiOperation({ summary: '小程序上传图片（用于简答题答案）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '图片文件（支持 jpg、png、gif、webp）',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    if (!file) {
      throw new BadRequestException('文件不能为空');
    }

    // 小程序端上传，使用用户的 openid
    const openid = user?.openid || '';
    const imageUrl = await this.uploadService.uploadImage(file, 'answers', openid);
    return CommonResponseDto.success({
      url: imageUrl,
      imageUrl, // 兼容前端可能使用的字段名
    });
  }
}

/**
 * 图片代理：解决管理端跨域无法直接显示 TCB 图片的问题（无需登录）
 */
@ApiTags('文件上传')
@Controller('admin/upload')
export class ProxyImageController {
  constructor(private readonly uploadService: UploadService) {}

  @Get('proxy-image')
  @ApiOperation({ summary: '代理 TCB 图片（避免 CORS）' })
  @Header('Access-Control-Allow-Origin', '*')
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      throw new BadRequestException('缺少参数 url');
    }
    const decoded = decodeURIComponent(url);
    const { data, contentType } = await this.uploadService.proxyImage(decoded);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(data);
  }
}

