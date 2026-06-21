import { Body, Controller, Get, Post, Param, Query, UseGuards, Res, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { CourseService } from './course.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseCategory } from '../../database/entities/course-category.entity';
import { Course } from '../../database/entities/course.entity';

@ApiTags('课程')
@Controller('app/courses')
export class CourseController {
  constructor(
    private readonly courseService: CourseService,
    @InjectRepository(CourseCategory)
    private courseCategoryRepository: Repository<CourseCategory>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '所有课程列表' })
  async getAllCourses(
    @Query('keyword') keyword?: string,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('sortBy') sortBy?: string,
    @Query('courseTypeId') courseTypeId?: string,
    @CurrentUser() user?: any,
  ) {
    const result = await this.courseService.getAllCourses(
      keyword,
      category,
      subCategory,
      sortBy,
      user?.userId,
      courseTypeId ? Number(courseTypeId) : undefined,
    );
    return CommonResponseDto.success(result);
  }

  @Post(':id/preview-ticket')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取小程序内嵌 PDF 预览用短期凭证与 viewer 地址' })
  async getPreviewTicket(
    @Param('id') id: string,
    @Query('fileId') fileIdStr: string | undefined,
    @CurrentUser() user: any,
  ) {
    const courseId = +id;
    const fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
    const result = await this.courseService.createPreviewTicket(
      courseId,
      user?.userId,
      Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
    );
    return CommonResponseDto.success(result);
  }

  @Get(':id/document-preview-url')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取课程文档预览地址（doc/docx 等小程序 openDocument 使用）' })
  async getDocumentPreviewUrl(
    @Param('id') id: string,
    @Query('ticket') ticket: string | undefined,
    @Query('fileId') fileIdStr: string | undefined,
    @CurrentUser() user: any,
  ) {
    const courseId = +id;
    let userId = user?.userId;
    let fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
    if (ticket && !userId) {
      const verified = this.courseService.verifyPreviewTicket(ticket);
      if (verified && verified.courseId === courseId) {
        userId = verified.userId ?? undefined;
        if (!fileId && verified.fileId) fileId = verified.fileId;
      }
    }
    const result = await this.courseService.getCourseDocumentPreviewUrl(
      courseId,
      userId,
      Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
    );
    return CommonResponseDto.success(result);
  }

  @Get(':id/file-preview')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '课程文件试读（付费未购买时返回前 3 页 PDF）' })
  async getCourseFilePreview(
    @Param('id') id: string,
    @Query('maxPages') maxPagesStr: string | undefined,
    @Query('ticket') ticket: string | undefined,
    @Query('fileId') fileIdStr: string | undefined,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    const courseId = +id;
    let userId = user?.userId;
    let fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
    if (ticket && !userId) {
      const verified = this.courseService.verifyPreviewTicket(ticket);
      if (verified && verified.courseId === courseId) {
        userId = verified.userId ?? undefined;
        if (!fileId && verified.fileId) fileId = verified.fileId;
      }
    }
    const { course, hasAuth } = await this.courseService.getCourseAccessContext(courseId, userId);
    const courseFile = await this.courseService.resolveCourseFile(
      courseId,
      Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
    );
    if (course.content_type !== 'file') {
      return res.status(404).send('课程无文件');
    }
    const maxPages = Math.min(10, Math.max(1, parseInt(maxPagesStr || '3', 10) || 3));
    const allowSourceFile = course.allow_source_file !== 0;
    if (allowSourceFile && (hasAuth || Number(course.price) === 0 || course.is_free === 1)) {
      return res.redirect(302, courseFile.file_url);
    }
    if (!['pdf', 'doc', 'docx'].includes((courseFile.file_type || '').toLowerCase())) {
      return res.status(403).send('仅支持 PDF/Word 试读');
    }
    const buffer = await this.courseService.getCourseFilePreviewPdf(
      courseId,
      maxPages,
      courseFile.id,
    );
    const etag = this.createBufferEtag(buffer);
    if (this.isFresh(req, etag)) {
      return res.status(304).end();
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    this.setCacheHeaders(res, etag, 86400);
    res.send(buffer);
  }

  @Get(':id/preview-pages-info')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '课程文件预览页数（图片预览用）' })
  async getPreviewPagesInfo(
    @Param('id') id: string,
    @Query('ticket') ticket: string | undefined,
    @Query('fileId') fileIdStr: string | undefined,
    @CurrentUser() user: any,
  ) {
    const courseId = +id;
    let userId = user?.userId;
    let fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
    if (ticket && !userId) {
      const verified = this.courseService.verifyPreviewTicket(ticket);
      if (verified && verified.courseId === courseId) {
        userId = verified.userId ?? undefined;
        if (!fileId && verified.fileId) fileId = verified.fileId;
      }
    }
    const info = await this.courseService.getCourseFilePreviewPageInfo(
      courseId,
      userId,
      Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
    );
    return CommonResponseDto.success(info);
  }

  @Get(':id/preview-page/:pageNum')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '课程文件指定页图片（PDF 转 PNG，用于图片预览）' })
  async getPreviewPageImage(
    @Param('id') id: string,
    @Param('pageNum') pageNumStr: string,
    @Query('ticket') ticket: string | undefined,
    @Query('fileId') fileIdStr: string | undefined,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    const courseId = +id;
    const pageNum = parseInt(pageNumStr, 10);
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      return res.status(400).send('页码无效');
    }
    let userId = user?.userId;
    let fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
    if (ticket && !userId) {
      const verified = this.courseService.verifyPreviewTicket(ticket);
      if (verified && verified.courseId === courseId) {
        userId = verified.userId ?? undefined;
        if (!fileId && verified.fileId) fileId = verified.fileId;
      }
    }
    const { buffer, contentType } = await this.courseService.getCourseFilePreviewPageImage(
      courseId,
      pageNum,
      userId,
      Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
    );
    const etag = this.createBufferEtag(buffer);
    if (this.isFresh(req, etag)) {
      return res.status(304).end();
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    this.setCacheHeaders(res, etag, 86400);
    res.send(buffer);
  }

  private createBufferEtag(buffer: Buffer): string {
    return `"${createHash('sha1').update(buffer).digest('base64url')}"`;
  }

  private isFresh(req: Request, etag: string): boolean {
    return req.headers['if-none-match']
      ?.split(',')
      .map((value) => value.trim())
      .includes(etag) ?? false;
  }

  private setCacheHeaders(res: Response, etag: string, maxAgeSeconds: number) {
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}`);
    res.setHeader('Vary', 'Authorization');
  }

  @Get(':id/detail')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '课程详情' })
  async getCourseDetail(
    @Param('id') id: number,
    @CurrentUser() user?: any,
  ) {
    const userId = user?.userId;
    const result = await this.courseService.getCourseDetail(+id, userId);
    return CommonResponseDto.success(result);
  }

  @Get(':id/file-reading-progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取文件课程阅读进度' })
  async getFileCourseProgress(
    @Param('id') id: string,
    @Query('fileId') fileIdStr: string | undefined,
    @CurrentUser() user: any,
  ) {
    const fileId = fileIdStr ? parseInt(fileIdStr, 10) : undefined;
    const result = await this.courseService.getFileCourseProgress(
      user.userId,
      +id,
      Number.isInteger(fileId) && fileId > 0 ? fileId : undefined,
    );
    return CommonResponseDto.success(result);
  }

  @Post(':id/file-reading-progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '记录文件课程阅读进度' })
  async recordFileCourseProgress(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: Record<string, unknown>,
  ) {
    const result = await this.courseService.recordFileCourseProgress(user.userId, +id, body);
    return CommonResponseDto.success(result);
  }

  @Get('categories')
  @ApiOperation({ summary: '获取课程分类树（包含课程列表）' })
  async getCourseCategories() {
    try {
      // 查询所有启用的分类
      const categories = await this.courseCategoryRepository.find({
        where: { status: 1 },
        order: { sort: 'ASC', id: 'ASC' },
      });

      if (!categories || categories.length === 0) {
        return CommonResponseDto.success([]);
      }

      // 构建分类树
      const categoryMap = new Map<number, any>();
      categories.forEach((category) => {
        categoryMap.set(category.id, { ...category, children: [] });
      });

      const tree: any[] = [];
      categoryMap.forEach((category) => {
        if (category.parent_id) {
          const parent = categoryMap.get(category.parent_id);
          if (parent) {
            parent.children.push(category);
          }
        } else {
          tree.push(category);
        }
      });

      // 为每个二级分类获取课程列表
      const result = await Promise.all(
        tree.map(async (primaryCategory) => {
          const childrenWithCourses = await Promise.all(
            primaryCategory.children.map(async (subCategory) => {
              // 查询该二级分类下的所有课程
              const courses = await this.courseRepository.find({
                where: {
                  category: primaryCategory.name,
                  sub_category: subCategory.name,
                  status: 1,
                },
                order: { sort: 'ASC', id: 'ASC' },
              });

              return {
                ...subCategory,
                courses: courses || [],
              };
            })
          );

          return {
            ...primaryCategory,
            children: childrenWithCourses,
          };
        })
      );

      return CommonResponseDto.success(result);
    } catch (error) {
      console.error('获取课程分类失败:', error);
      throw error;
    }
  }

  @Get('recommendations')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取课程相关推荐' })
  async getRecommendations(@Query('courseId') courseId?: string | number, @CurrentUser() user?: any) {
    // 处理 courseId：如果为空、undefined 或无效，则传递 undefined
    let parsedCourseId: number | undefined = undefined;
    
    if (courseId !== undefined && courseId !== null && courseId !== '') {
      const numId = typeof courseId === 'string' ? parseInt(courseId, 10) : Number(courseId);
      if (!isNaN(numId) && Number.isFinite(numId) && numId > 0) {
        parsedCourseId = numId;
      }
    }
    
    const userId = user?.userId;
    const result = await this.courseService.getRecommendations(parsedCourseId, userId);
    return CommonResponseDto.success(result);
  }
}
