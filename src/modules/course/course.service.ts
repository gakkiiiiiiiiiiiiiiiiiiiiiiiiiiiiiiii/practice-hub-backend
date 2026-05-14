import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { CourseRecommendation } from '../../database/entities/course-recommendation.entity';
import { UserFileCourseProgress } from '../../database/entities/user-file-course-progress.entity';

const execFileAsync = promisify(execFile);
const PREVIEW_IMAGE_WIDTH = 900;
const PREVIEW_IMAGE_DENSITY = 100;
const PREVIEW_IMAGE_QUALITY = 72;

@Injectable()
export class CourseService {
  private readonly logger = new Logger(CourseService.name);
  private readonly previewRenderTasks = new Map<string, Promise<{ buffer: Buffer; contentType: string }>>();

  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    @InjectRepository(CourseRecommendation)
    private courseRecommendationRepository: Repository<CourseRecommendation>,
    @InjectRepository(UserFileCourseProgress)
    private userFileCourseProgressRepository: Repository<UserFileCourseProgress>,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  /**
   * 获取所有课程列表
   */
  async getAllCourses(keyword?: string, category?: string, subCategory?: string, sortBy?: string, userId?: number) {
    const queryBuilder = this.courseRepository.createQueryBuilder('course');

    // 关键词搜索
    if (keyword) {
      queryBuilder.where(
        '(course.name LIKE :keyword OR course.subject LIKE :keyword OR course.school LIKE :keyword OR course.major LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    // 分类筛选
    if (category) {
      if (keyword) {
        queryBuilder.andWhere('course.category = :category', { category });
      } else {
        queryBuilder.where('course.category = :category', { category });
      }
    }

    // 二级分类筛选
    if (subCategory) {
      if (keyword || category) {
        queryBuilder.andWhere('course.sub_category = :subCategory', { subCategory });
      } else {
        queryBuilder.where('course.sub_category = :subCategory', { subCategory });
      }
    }

    // 排序
    if (sortBy === 'sales') {
      // 按学习人数排序（销量优先）
      queryBuilder.orderBy('course.student_count', 'DESC');
    } else if (sortBy === 'latest') {
      // 按创建时间排序（最新题库）
      queryBuilder.orderBy('course.create_time', 'DESC');
    } else if (sortBy === 'price_asc') {
      // 按价格升序
      queryBuilder.orderBy('course.price', 'ASC');
    } else if (sortBy === 'price_desc') {
      // 按价格降序
      queryBuilder.orderBy('course.price', 'DESC');
    } else {
      // 默认按排序字段排序（综合排序）
      queryBuilder.orderBy('course.sort', 'ASC');
    }

    const courses = await queryBuilder.getMany();
    if (!userId || courses.length === 0) {
      return courses.map((course) => ({
        ...course,
        hasAuth: Number(course.price) === 0 || course.is_free === 1,
      }));
    }

    const courseIds = courses.map((course) => course.id);
    const auths = await this.userCourseAuthRepository.find({
      where: {
        user_id: userId,
        course_id: In(courseIds),
      },
    });
    const now = Date.now();
    const authMap = new Map(
      auths
        .filter((auth) => !auth.expire_time || new Date(auth.expire_time).getTime() > now)
        .map((auth) => [auth.course_id, auth]),
    );

    return courses.map((course) => ({
      ...course,
      hasAuth: Number(course.price) === 0 || course.is_free === 1 || authMap.has(course.id),
      expireTime: authMap.get(course.id)?.expire_time || null,
    }));
  }

  /**
   * 获取课程详情
   */
  async getCourseDetail(courseId: number, userId?: number) {
    const { course, hasAuth, expireTime } = await this.queryWithRetry(
      () => this.getCourseAccessContext(courseId, userId, true),
      '获取课程访问信息',
    );

    // 获取章节列表
    const chapters = await this.queryWithRetry(
      () =>
        this.chapterRepository.find({
          where: { course_id: courseId },
          order: { sort: 'ASC' },
          relations: ['course'],
        }),
      '获取课程章节列表',
    );

    const fileType = (course.file_type || '').toLowerCase();
    const isFileCourse = course.content_type === 'file' && course.file_url;
    const allowSourceFile = course.allow_source_file !== 0;
    const price = Number(course.price) || 0;
    const needPreviewUrl =
      isFileCourse && !hasAuth && price > 0 && (fileType === 'pdf' || fileType === 'doc' || fileType === 'docx');

    return {
      ...course,
      file_url: allowSourceFile ? course.file_url : null,
      allow_source_file: allowSourceFile ? 1 : 0,
      chapters,
      hasAuth,
      expireTime,
      /** 付费未购买时，试读用：PDF 为前 3 页地址，Word 暂不提供试读 */
      file_preview_url: needPreviewUrl && fileType === 'pdf' ? `/api/app/courses/${courseId}/file-preview` : undefined,
    };
  }

  /**
   * 获取小程序文档预览地址。
   * 用于 allow_source_file 关闭时仍允许已购买/免费用户在小程序内打开 doc/docx。
   */
  async getCourseDocumentPreviewUrl(
    courseId: number,
    userId?: number,
  ): Promise<{ url: string; fileType: string; fileName: string }> {
    const { course, hasAuth } = await this.getCourseAccessContext(courseId, userId);
    if (course.content_type !== 'file' || !course.file_url) {
      throw new NotFoundException('课程无文件或非文件课程');
    }

    const fileType = (course.file_type || '').toLowerCase();
    if (!['doc', 'docx', 'pdf'].includes(fileType)) {
      throw new BadRequestException('暂不支持该文件类型预览');
    }

    const canPreview = hasAuth || Number(course.price) === 0 || course.is_free === 1;
    if (!canPreview) {
      throw new BadRequestException('请先购买课程');
    }

    return {
      url: course.file_url,
      fileType,
      fileName: course.file_name || `course.${fileType}`,
    };
  }

  async getCourseAccessContext(courseId: number, userId?: number, withChapters = false) {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      relations: withChapters ? ['chapters'] : [],
    });

    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    let hasAuth = false;
    let expireTime: Date | null = null;
    const price = Number(course.price) || 0;
    const isFree = course.is_free === 1;
    if (price === 0 || isFree) {
      hasAuth = true;
    } else if (userId) {
      const auth = await this.userCourseAuthRepository.findOne({
        where: {
          user_id: userId,
          course_id: courseId,
        },
      });
      if (auth) {
        hasAuth = !auth.expire_time || auth.expire_time > new Date();
        expireTime = auth.expire_time;
      }
    }

    return { course, hasAuth, expireTime };
  }

  async getFileCourseProgress(userId: number, courseId: number) {
    await this.assertFileCourse(courseId);
    const progress = await this.userFileCourseProgressRepository.findOne({
      where: { user_id: userId, course_id: courseId },
    });

    return this.formatFileCourseProgress(progress, courseId);
  }

  async recordFileCourseProgress(
    userId: number,
    courseId: number,
    body: {
      currentPage?: unknown;
      totalPages?: unknown;
      durationSeconds?: unknown;
    },
  ) {
    await this.assertFileCourse(courseId);

    const totalPages = this.parseNonNegativeInteger(body.totalPages, 'totalPages');
    const rawCurrentPage = this.parseNonNegativeInteger(body.currentPage, 'currentPage');
    const currentPage = totalPages > 0 ? Math.min(rawCurrentPage, totalPages) : rawCurrentPage;
    const durationSeconds = Math.min(
      this.parseNonNegativeInteger(body.durationSeconds, 'durationSeconds'),
      3600,
    );

    let progress = await this.userFileCourseProgressRepository.findOne({
      where: { user_id: userId, course_id: courseId },
    });
    if (!progress) {
      progress = this.userFileCourseProgressRepository.create({
        user_id: userId,
        course_id: courseId,
        current_page: 0,
        total_pages: 0,
        total_seconds: 0,
      });
    }

    progress.current_page = Math.max(progress.current_page || 0, currentPage);
    progress.total_pages = Math.max(progress.total_pages || 0, totalPages);
    progress.total_seconds = Math.max(0, progress.total_seconds || 0) + durationSeconds;
    progress.last_read_at = new Date();

    const saved = await this.userFileCourseProgressRepository.save(progress);
    return this.formatFileCourseProgress(saved, courseId);
  }

  private async assertFileCourse(courseId: number) {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      select: ['id', 'content_type', 'file_url'],
    });
    if (!course || course.content_type !== 'file' || !course.file_url) {
      throw new NotFoundException('课程无文件或非文件课程');
    }
  }

  private parseNonNegativeInteger(value: unknown, field: string): number {
    const numberValue = Number(value ?? 0);
    if (!Number.isInteger(numberValue) || numberValue < 0) {
      throw new BadRequestException(`${field} 必须是非负整数`);
    }
    return numberValue;
  }

  private formatFileCourseProgress(progress: UserFileCourseProgress | null, courseId: number) {
    return {
      courseId,
      currentPage: progress?.current_page || 0,
      totalPages: progress?.total_pages || 0,
      totalSeconds: progress?.total_seconds || 0,
      lastReadAt: progress?.last_read_at || null,
    };
  }

  private async queryWithRetry<T>(
    queryFn: () => Promise<T>,
    action: string,
    retries = 3,
    delay = 300,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await queryFn();
      } catch (error: any) {
        lastError = error;
        if (!this.isTransientDatabaseError(error) || attempt >= retries) {
          throw error;
        }

        this.logger.warn(`${action}遇到数据库连接中断，准备重试 (${attempt}/${retries}): ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }

    throw lastError;
  }

  private isTransientDatabaseError(error: any): boolean {
    const code = error?.code || error?.errno;
    const message = String(error?.message || '');
    return (
      code === 'ECONNRESET' ||
      code === 'PROTOCOL_CONNECTION_LOST' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      message.includes('ECONNRESET') ||
      message.includes('Connection lost') ||
      message.includes('read ECONNRESET') ||
      message.includes('Pool is closed')
    );
  }

  /**
   * 获取课程文件预览 PDF（前 maxPages 页），仅支持 PDF 类型
   */
  async getCourseFilePreviewPdf(courseId: number, maxPages: number = 3): Promise<Buffer> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      select: ['id', 'content_type', 'file_url', 'file_type'],
    });
    if (!course || course.content_type !== 'file' || !course.file_url) {
      throw new NotFoundException('课程无文件或非文件课程');
    }
    const fileType = (course.file_type || '').toLowerCase();
    if (fileType !== 'pdf') {
      throw new NotFoundException('仅支持 PDF 试读');
    }
    const res = await axios.get(course.file_url, { responseType: 'arraybuffer', timeout: 30000 });
    const bytes = res.data as ArrayBuffer;
    const donorDoc = await PDFDocument.load(bytes);
    const pageCount = donorDoc.getPageCount();
    const pagesToCopy = Math.min(maxPages, Math.max(1, pageCount));
    if (pagesToCopy < 1) {
      throw new NotFoundException('PDF 无有效页');
    }
    const indices = Array.from({ length: pagesToCopy }, (_, i) => i);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(donorDoc, indices);
    copied.forEach((p) => newDoc.addPage(p));
    const pdfBytes = await newDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * 获取课程文件预览页数（用于图片预览：已购/免费为全部，未购付费为 3）
   */
  async getCourseFilePreviewPageInfo(
    courseId: number,
    userId?: number,
  ): Promise<{ totalPages: number; cacheVersion: string }> {
    const { course, hasAuth } = await this.getCourseAccessContext(courseId, userId);
    if (course.content_type !== 'file' || !course.file_url || (course.file_type || '').toLowerCase() !== 'pdf') {
      throw new NotFoundException('课程无 PDF 文件');
    }
    const res = await axios.get(course.file_url, { responseType: 'arraybuffer', timeout: 30000 });
    const bytes = res.data as ArrayBuffer;
    const doc = await PDFDocument.load(bytes);
    const fullCount = doc.getPageCount();
    const totalPages =
      hasAuth || Number(course.price) === 0 || course.is_free === 1 ? fullCount : Math.min(3, fullCount);
    const previewScope =
      hasAuth || Number(course.price) === 0 || course.is_free === 1 ? 'full' : 'trial';
    return {
      totalPages: Math.max(1, totalPages),
      cacheVersion: this.getPreviewCacheVersion(course.file_url, previewScope),
    };
  }

  /**
   * 将课程 PDF 指定页转为预览图（用于小程序内图片预览）
   * 使用 JPEG 以在尽量保持清晰度的前提下降低传输体积。
   * 依赖 pdf2pic（需系统安装 GraphicsMagick + Ghostscript），失败时抛出
   */
  async getCourseFilePreviewPageImage(
    courseId: number,
    pageNum: number,
    userId?: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { course, hasAuth } = await this.getCourseAccessContext(courseId, userId);
    if (course.content_type !== 'file' || !course.file_url || (course.file_type || '').toLowerCase() !== 'pdf') {
      throw new NotFoundException('课程无 PDF 文件');
    }
    const maxPages =
      hasAuth || Number(course.price) === 0 || course.is_free === 1
        ? 999
        : 3;
    if (pageNum < 1 || pageNum > maxPages) {
      throw new NotFoundException('页码超出范围');
    }
	    const previewScope =
	      hasAuth || Number(course.price) === 0 || course.is_free === 1 ? 'full' : 'trial';
	    const cachePath = this.getPreviewImageCachePath(courseId, pageNum, course.file_url, previewScope);
	    if (fs.existsSync(cachePath)) {
	      const cached = fs.readFileSync(cachePath);
	      if (cached.length > 8) {
	        return { buffer: cached, contentType: 'image/jpeg' };
	      }
	      try {
	        fs.unlinkSync(cachePath);
	      } catch (_) {}
	    }

    const taskKey = `${courseId}:${previewScope}:${this.getPreviewCacheVersion(course.file_url, previewScope)}:${pageNum}`;
    const existingTask = this.previewRenderTasks.get(taskKey);
    if (existingTask) {
      return existingTask;
    }

    const renderTask = this.renderAndCachePreviewPage({
      course,
      hasAuth,
      courseId,
      pageNum,
      cachePath,
    }).finally(() => {
      this.previewRenderTasks.delete(taskKey);
    });
    this.previewRenderTasks.set(taskKey, renderTask);
    return renderTask;
  }

  private async renderAndCachePreviewPage({
    course,
    hasAuth,
    courseId,
    pageNum,
    cachePath,
  }: {
    course: Course;
    hasAuth: boolean;
    courseId: number;
    pageNum: number;
    cachePath: string;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    let pdfBuffer: Buffer;
    if (hasAuth || Number(course.price) === 0 || course.is_free === 1) {
      const res = await axios.get(course.file_url, { responseType: 'arraybuffer', timeout: 30000 });
      pdfBuffer = Buffer.from(res.data as ArrayBuffer);
    } else {
      pdfBuffer = await this.getCourseFilePreviewPdf(courseId, 3);
    }

    const tmpDir = path.join(os.tmpdir(), `course-preview-${courseId}-${pageNum}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, 'doc.pdf');
    try {
      fs.writeFileSync(pdfPath, pdfBuffer);
      let buffer: Buffer | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          buffer = await this.renderPdfPageToJpeg(pdfPath, pageNum, tmpDir);
          if (buffer && Buffer.isBuffer(buffer) && buffer.length > 8) break;
          lastError = new Error('PDF 转图未生成有效图片');
        } catch (error) {
          lastError = error;
        }
        await this.sleep(250 * attempt);
      }
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length <= 8) {
        const message = lastError instanceof Error ? lastError.message : 'PDF 转图未生成有效图片';
        throw new Error(`${message}，请确认容器已安装 Ghostscript、Poppler，并查看前置转图命令错误日志`);
      }
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, buffer);
      this.logger.log(
        `PDF预览页生成成功 course=${courseId} page=${pageNum} size=${buffer.length} bytes`,
      );
      return { buffer, contentType: 'image/jpeg' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`课程预览页转图失败: ${message}`);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  private async renderPdfPageToJpeg(pdfPath: string, pageNum: number, tmpDir: string): Promise<Buffer | undefined> {
    const gsBuffer = await this.renderPdfPageWithGhostscript(pdfPath, pageNum, tmpDir);
    if (gsBuffer && gsBuffer.length > 8) return gsBuffer;

    const popplerBuffer = await this.renderPdfPageWithPoppler(pdfPath, pageNum, tmpDir);
    if (popplerBuffer && popplerBuffer.length > 8) return popplerBuffer;

    try {
      const { fromPath } = await import('pdf2pic');
      const convert = fromPath(pdfPath, {
        format: 'jpeg',
        quality: PREVIEW_IMAGE_QUALITY,
        width: PREVIEW_IMAGE_WIDTH,
        preserveAspectRatio: true,
        density: PREVIEW_IMAGE_DENSITY,
      });
      let result = await this.withTimeout(
        convert(pageNum, { responseType: 'buffer' }) as Promise<unknown>,
        8000,
        'PDF 预览图生成超时，请稍后重试',
      );
      let buffer = this.readPdf2PicResultBuffer(result);
      if (!buffer || buffer.length <= 8) {
        try {
          convert.setGMClass('imagemagick');
          result = await this.withTimeout(
            convert(pageNum, { responseType: 'buffer' }) as Promise<unknown>,
            8000,
            'PDF 预览图生成超时，请稍后重试',
          );
          buffer = this.readPdf2PicResultBuffer(result);
        } catch (_) {}
      }
      return buffer;
    } catch (_) {
      return undefined;
    }
  }

  private async renderPdfPageWithPoppler(pdfPath: string, pageNum: number, tmpDir: string): Promise<Buffer | undefined> {
    const outputPrefix = path.join(tmpDir, `poppler-page-${pageNum}`);
    const outputPath = `${outputPrefix}.jpg`;
    try {
      await this.withTimeout(
        execFileAsync('pdftoppm', [
          '-jpeg',
          '-jpegopt',
          `quality=${PREVIEW_IMAGE_QUALITY}`,
          '-r',
          String(PREVIEW_IMAGE_DENSITY),
          '-f',
          String(pageNum),
          '-l',
          String(pageNum),
          '-singlefile',
          pdfPath,
          outputPrefix,
        ]),
        12000,
        'Poppler 预览图生成超时，请稍后重试',
      );
      if (!fs.existsSync(outputPath)) return undefined;
      const buffer = fs.readFileSync(outputPath);
      return buffer.length > 8 ? buffer : undefined;
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PDF预览] Poppler 转图失败:', stderr || message);
      return undefined;
    }
  }

  private async renderPdfPageWithGhostscript(pdfPath: string, pageNum: number, tmpDir: string): Promise<Buffer | undefined> {
    const outputPath = path.join(tmpDir, `page-${pageNum}.jpg`);
    try {
      await this.withTimeout(
        execFileAsync('gs', [
          '-dSAFER',
          '-dBATCH',
          '-dNOPAUSE',
          '-sDEVICE=jpeg',
          `-dJPEGQ=${PREVIEW_IMAGE_QUALITY}`,
          `-r${PREVIEW_IMAGE_DENSITY}`,
          `-dFirstPage=${pageNum}`,
          `-dLastPage=${pageNum}`,
          `-sOutputFile=${outputPath}`,
          pdfPath,
        ]),
        12000,
        'Ghostscript 预览图生成超时，请稍后重试',
      );
      if (!fs.existsSync(outputPath)) return undefined;
      const buffer = fs.readFileSync(outputPath);
      return buffer.length > 8 ? buffer : undefined;
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PDF预览] Ghostscript 转图失败:', stderr || message);
      return undefined;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	    return new Promise((resolve, reject) => {
	      const timer = setTimeout(() => reject(new Error(message)), ms);
	      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
	        });
	    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private readPdf2PicResultBuffer(result: unknown): Buffer | undefined {
	    if (!result) return undefined;
	    if (Buffer.isBuffer(result)) return result;
	    if (result instanceof Uint8Array) return Buffer.from(result);
	    if (typeof result === 'string') return Buffer.from(result, 'base64');
	    if (typeof result !== 'object') return undefined;

	    const value = result as {
	      buffer?: Buffer | Uint8Array;
	      data?: Buffer | Uint8Array | string;
	      base64?: string;
	      path?: string;
	    };
	    if (Buffer.isBuffer(value.buffer)) return value.buffer;
	    if (value.buffer instanceof Uint8Array) return Buffer.from(value.buffer);
	    if (Buffer.isBuffer(value.data)) return value.data;
	    if (value.data instanceof Uint8Array) return Buffer.from(value.data);
	    if (typeof value.data === 'string') return Buffer.from(value.data, 'base64');
	    if (value.base64) return Buffer.from(value.base64, 'base64');
	    if (value.path && fs.existsSync(value.path)) return fs.readFileSync(value.path);
	    return undefined;
	  }

  private getPreviewImageCachePath(
    courseId: number,
    pageNum: number,
    fileUrl: string,
    scope: 'full' | 'trial',
  ): string {
    const version = this.getPreviewCacheVersion(fileUrl, scope);
    return path.join(os.tmpdir(), 'course-preview-cache', String(courseId), version, `${pageNum}.jpg`);
  }

  private getPreviewCacheVersion(fileUrl: string, scope: 'full' | 'trial'): string {
    return createHash('md5')
      .update(`${fileUrl}|${scope}|jpeg|${PREVIEW_IMAGE_WIDTH}|${PREVIEW_IMAGE_DENSITY}|${PREVIEW_IMAGE_QUALITY}|v2`)
      .digest('hex')
      .slice(0, 12);
  }

  /**
   * 获取课程相关推荐
   * 优先使用课程级别的配置（course.recommended_course_ids），如果没有则使用公共配置（course_recommendation）
   * 如果都没有配置，返回默认推荐（排除当前课程的其他课程）
   * @param courseId 当前课程ID（可选）
   * @param userId 用户ID（可选，用于获取用户的课程权限和到期时间）
   */
  async getRecommendations(courseId?: number, userId?: number) {
    let recommendedCourseIds: number[] = [];
    
    if (courseId !== undefined && courseId !== null) {
      const numValue = typeof courseId === 'number' ? courseId : Number(courseId);
      if (Number.isFinite(numValue) && !isNaN(numValue) && numValue > 0) {
        // 先查找课程级别的配置（存储在 course 表中）
        const course = await this.courseRepository.findOne({
          where: { id: numValue },
          select: ['id', 'recommended_course_ids'],
        });
        
        if (course && course.recommended_course_ids && course.recommended_course_ids.length > 0) {
          recommendedCourseIds = course.recommended_course_ids;
        }
      }
    }
    
    // 如果没有课程级别的配置，查找公共配置（course_recommendation 表）
    if (recommendedCourseIds.length === 0) {
      // 使用 find 方法获取第一条记录，因为 findOne 需要 where 条件
      const recommendations = await this.courseRecommendationRepository.find({
        order: { id: 'ASC' },
        take: 1, // 只取第一条记录
      });
      
      const recommendation = recommendations.length > 0 ? recommendations[0] : null;
      
      if (recommendation && recommendation.recommended_course_ids && recommendation.recommended_course_ids.length > 0) {
        recommendedCourseIds = recommendation.recommended_course_ids;
      }
    }

    // 如果有配置的推荐课程ID，返回这些课程
    let recommendedCourses = [];
    if (recommendedCourseIds.length > 0) {
      recommendedCourses = await this.courseRepository.find({
        where: { id: In(recommendedCourseIds) },
        order: { sort: 'ASC' },
      });
    } else {
      // 如果没有配置或配置为空，返回默认推荐（排除当前课程的其他课程）
      const queryBuilder = this.courseRepository.createQueryBuilder('course');
      queryBuilder.orderBy('course.sort', 'ASC');
      
      // 如果有当前课程ID，排除它
      if (courseId !== undefined && courseId !== null) {
        const numValue = typeof courseId === 'number' ? courseId : Number(courseId);
        if (Number.isFinite(numValue) && !isNaN(numValue) && numValue > 0) {
          queryBuilder.where('course.id != :courseId', { courseId: numValue });
        }
      }
      
      // 限制返回数量，避免返回过多课程
      queryBuilder.limit(10);
      
      recommendedCourses = await queryBuilder.getMany();
    }

    // 如果用户已登录，获取用户的课程权限和到期时间
    if (userId && recommendedCourses.length > 0) {
      const courseIds = recommendedCourses.map(c => c.id);
      const userAuths = await this.userCourseAuthRepository.find({
        where: {
          user_id: userId,
          course_id: In(courseIds),
        },
      });

      // 创建权限映射
      const authMap = new Map();
      userAuths.forEach(auth => {
        authMap.set(auth.course_id, auth);
      });

      // 为每个课程添加权限和到期时间信息
      return recommendedCourses.map(course => {
        const auth = authMap.get(course.id);
        return {
          ...course,
          expireTime: auth?.expire_time || null,
        };
      });
    }

    return recommendedCourses;
  }

  /**
   * 生成小程序内嵌 PDF 预览用短期凭证（5 分钟有效）
   */
  async createPreviewTicket(courseId: number, userId?: number): Promise<{ ticket: string; viewerUrl: string }> {
    const course = await this.courseRepository.findOne({ where: { id: courseId }, select: ['id', 'content_type', 'file_type'] });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const payload = { courseId, userId: userId ?? null, purpose: 'pdf-viewer' };
    const ticket = this.jwtService.sign(payload, { expiresIn: '5m' });
    const baseUrl = (this.configService.get('BASE_URL') || '').replace(/\/$/, '');
    const apiPrefix = baseUrl ? `${baseUrl}/api` : '/api';
    const viewerUrl = `${apiPrefix}/app/pdf-viewer?courseId=${courseId}&ticket=${encodeURIComponent(ticket)}`;
    return { ticket, viewerUrl };
  }

  /**
   * 校验预览凭证并返回 userId（用于 file-preview 接口）
   */
  verifyPreviewTicket(ticket: string): { courseId: number; userId: number | null } | null {
    try {
      const payload = this.jwtService.verify(ticket) as { courseId?: number; userId?: number; purpose?: string };
      if (payload.purpose !== 'pdf-viewer' || payload.courseId == null) return null;
      return { courseId: payload.courseId, userId: payload.userId ?? null };
    } catch {
      return null;
    }
  }
}
