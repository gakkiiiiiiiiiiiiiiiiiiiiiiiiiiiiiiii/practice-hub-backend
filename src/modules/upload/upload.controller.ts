import {
  Controller,
  Post,
  Get,
  Query,
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
          description: '图片文件（支持 jpg、png、gif、webp，最大 5MB）',
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
          description: '图片文件（支持 jpg、png、gif、webp，最大 5MB）',
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

