import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Req,
  Res,
  Header,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadImageBase64Dto } from './dto/upload-image-base64.dto';
import { AppUser, AppUserRole } from '../../database/entities/app-user.entity';

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
  constructor(
    private readonly uploadService: UploadService,
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
  ) {}

  private async assertAppAdmin(user: any) {
    const userId = Number(user?.userId || user?.id);
    if (userId) {
      const dbUser = await this.appUserRepository.findOne({ where: { id: userId }, select: ['id', 'role'] });
      if ([AppUserRole.ADMIN, AppUserRole.BANK_ADMIN].includes(dbUser?.role)) {
        return;
      }
    } else if ([AppUserRole.ADMIN, AppUserRole.BANK_ADMIN].includes(user?.role) || user?.is_admin === true || user?.is_bank_admin === true) {
      return;
    }
    throw new ForbiddenException('仅小程序管理员可上传课程');
  }

  @Post('course-file-cloud-path')
  @ApiOperation({ summary: '小程序管理员获取课程文件云存储路径（配合 wx.cloud.uploadFile）' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fileName'],
      properties: {
        fileName: { type: 'string', description: '原始文件名，如 xxx.pdf' },
      },
    },
  })
  async getCourseFileCloudPath(@Body() body: { fileName?: string }, @CurrentUser() user: any) {
    await this.assertAppAdmin(user);
    const fileName = body?.fileName?.trim();
    if (!fileName) {
      throw new BadRequestException('请传入 fileName');
    }
    const safeFileName = fileName.replace(/[\\/]/g, '').slice(0, 120);
    const ext = safeFileName.toLowerCase().match(/\.(pdf|doc|docx)$/)?.[0] || '';
    if (!ext) {
      throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
    }
    const userId = Number(user?.userId || user?.id) || 0;
    const cloudPath = `course-files/app-${userId || 'admin'}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}${ext}`;
    return CommonResponseDto.success({
      cloudPath,
      fileUrl: this.uploadService.getCosPublicUrl(cloudPath),
      fileName: safeFileName,
      fileType: ext.slice(1),
    });
  }

  @Post('image-upload-url')
  @ApiOperation({ summary: '小程序获取图片直传对象存储凭证' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '图片文件名，如 avatar.jpg' },
        folder: { type: 'string', description: '存储目录，默认 avatars' },
      },
    },
  })
  async getImageUploadUrl(@Body() body: { fileName?: string; folder?: string }, @CurrentUser() user: any) {
    const originalName = body?.fileName?.trim() || 'avatar.jpg';
    const ext = originalName.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/)?.[0] || '.jpg';
    const folder = (body?.folder || 'avatars').replace(/[^a-zA-Z0-9_-]/g, '') || 'avatars';
    const userId = Number(user?.userId) || 0;
    const path = `${folder}/${userId || 'user'}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}${ext}`;
    const credentials = await this.uploadService.getCourseFileUploadUrl(path);
    return CommonResponseDto.success({
      ...credentials,
      fileName: originalName,
      fileType: ext.slice(1),
    });
  }

  @Post('image-base64')
  @ApiOperation({ summary: '小程序 Base64 上传图片（JSON，配合云调用，无需 uploadFile 公网地址）' })
  async uploadImageBase64(@Body() dto: UploadImageBase64Dto, @CurrentUser() user: any) {
    const file = this.buildMulterFileFromBase64(dto);
    const openid = user?.openid || '';
    const folder = (dto.folder || 'avatars').replace(/[^a-zA-Z0-9_-]/g, '') || 'avatars';
    const imageUrl = await this.uploadService.uploadImage(file, folder, openid);
    return CommonResponseDto.success({
      url: imageUrl,
      imageUrl,
    });
  }

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

  private buildMulterFileFromBase64(dto: UploadImageBase64Dto): Express.Multer.File {
    let raw = dto.imageBase64.trim();
    let mime = 'image/jpeg';
    const dataUri = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUri) {
      mime = dataUri[1].trim();
      raw = dataUri[2].replace(/\s/g, '');
    } else {
      raw = raw.replace(/\s/g, '');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('无效的 Base64 数据');
    }
    if (!buffer.length) {
      throw new BadRequestException('图片内容为空');
    }
    const maxBytes = 2 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new BadRequestException('图片不能超过 2MB');
    }
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    let mimetype = mime.split(';')[0].trim().toLowerCase();
    if (!allowedMimeTypes.includes(mimetype)) {
      mimetype = this.sniffImageMime(buffer) || 'image/jpeg';
    }
    if (!allowedMimeTypes.includes(mimetype)) {
      throw new BadRequestException('不支持的图片类型');
    }
    const originalname = (dto.fileName?.trim() || 'avatar.jpg').replace(/[\\/]/g, '') || 'avatar.jpg';
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype,
      buffer,
      size: buffer.length,
    } as Express.Multer.File;
  }

  private sniffImageMime(buf: Buffer): string | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return 'image/png';
    }
    if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return 'image/gif';
    }
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
      return 'image/webp';
    }
    return null;
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
  async proxyImage(@Query('url') url: string, @Req() req: Request, @Res() res: Response) {
    if (!url) {
      throw new BadRequestException('缺少参数 url');
    }
    const decoded = decodeURIComponent(url);
    const { data, contentType } = await this.uploadService.proxyImage(decoded);
    const etag = `"${createHash('sha1').update(data).digest('base64url')}"`;
    const ifNoneMatch = req.headers['if-none-match']
      ?.split(',')
      .map((value) => value.trim())
      .includes(etag);
    if (ifNoneMatch) {
      return res.status(304).end();
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.send(data);
  }
}
