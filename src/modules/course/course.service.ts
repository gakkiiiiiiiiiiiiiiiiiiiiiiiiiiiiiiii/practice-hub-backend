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
import { CourseFile } from '../../database/entities/course-file.entity';
import { CourseFileService } from './course-file.service';
import { Chapter } from '../../database/entities/chapter.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { CourseRecommendation } from '../../database/entities/course-recommendation.entity';
import { UserFileCourseProgress } from '../../database/entities/user-file-course-progress.entity';
import { UploadService } from '../upload/upload.service';

const execFileAsync = promisify(execFile);
const PREVIEW_IMAGE_WIDTH = 1440;
const PREVIEW_IMAGE_DENSITY = 160;
const PREVIEW_IMAGE_QUALITY = 90;

export interface PreviewWarmupResult {
  courseId: number;
  totalPages: number;
  generated: number;
  skipped: number;
  failed: number;
  errors: Array<{ pageNum: number; message: string }>;
}

export interface PreviewWarmupProgress extends PreviewWarmupResult {
  status: 'pending' | 'running' | 'completed' | 'failed';
  courseName?: string;
  currentFileName?: string;
  currentPage: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  message?: string;
}

export type PreviewWarmupProgressListener = (progress: PreviewWarmupProgress) => void | Promise<void>;

@Injectable()
export class CourseService {
  private readonly logger = new Logger(CourseService.name);
  private readonly previewRenderTasks = new Map<string, Promise<{ buffer: Buffer; contentType: string }>>();
  private readonly previewWarmupTasks = new Map<string, Promise<PreviewWarmupResult>>();
  private readonly previewWarmupProgress = new Map<number, PreviewWarmupProgress>();

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
    private uploadService: UploadService,
    private courseFileService: CourseFileService,
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

    const courseFiles =
      course.content_type === 'file'
        ? (await this.courseFileService.listByCourseId(courseId)).map((file) =>
            this.courseFileService.formatFileListItem(file),
          )
        : [];
    const primaryFile = courseFiles[0];
    const fileType = (primaryFile?.file_type || course.file_type || '').toLowerCase();
    const isFileCourse = course.content_type === 'file' && courseFiles.length > 0;
    const allowSourceFile = course.allow_source_file !== 0;
    const price = Number(course.price) || 0;
    const needPreviewUrl =
      isFileCourse && !hasAuth && price > 0 && (fileType === 'pdf' || fileType === 'doc' || fileType === 'docx');

    return {
      ...course,
      files: courseFiles,
      file_url: allowSourceFile ? primaryFile?.file_url || course.file_url : null,
      file_name: primaryFile?.file_name || course.file_name,
      file_type: primaryFile?.file_type || course.file_type,
      file_size: primaryFile?.file_size ?? course.file_size,
      allow_source_file: allowSourceFile ? 1 : 0,
      chapters,
      hasAuth,
      expireTime,
      /** 付费未购买时，试读用：PDF 为前 3 页地址，Word 暂不提供试读 */
      file_preview_url:
        needPreviewUrl && fileType === 'pdf'
          ? `/api/app/courses/${courseId}/file-preview${primaryFile?.id ? `?fileId=${primaryFile.id}` : ''}`
          : undefined,
    };
  }

  /**
   * 获取小程序文档预览地址。
   * 用于 allow_source_file 关闭时仍允许已购买/免费用户在小程序内打开 doc/docx。
   */
  async getCourseDocumentPreviewUrl(
    courseId: number,
    userId?: number,
    fileId?: number,
  ): Promise<{ url: string; fileType: string; fileName: string; fileId: number }> {
    const { course, hasAuth } = await this.getCourseAccessContext(courseId, userId);
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    if (course.content_type !== 'file') {
      throw new NotFoundException('课程无文件或非文件课程');
    }

    const fileType = (courseFile.file_type || '').toLowerCase();
    if (!['doc', 'docx', 'pdf'].includes(fileType)) {
      throw new BadRequestException('暂不支持该文件类型预览');
    }

    const canPreview = hasAuth || Number(course.price) === 0 || course.is_free === 1;
    if (!canPreview) {
      throw new BadRequestException('请先购买课程');
    }

    return {
      url: courseFile.file_url,
      fileType,
      fileName: courseFile.file_name || courseFile.display_name || `course.${fileType}`,
      fileId: courseFile.id,
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

  async getFileCourseProgress(userId: number, courseId: number, fileId?: number) {
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    await this.courseFileService.assertFileCourseHasFiles(courseId);
    const progress = await this.userFileCourseProgressRepository.findOne({
      where: {
        user_id: userId,
        course_id: courseId,
        course_file_id: courseFile.id,
      },
    });

    return this.formatFileCourseProgress(progress, courseId, courseFile.id);
  }

  async recordFileCourseProgress(
    userId: number,
    courseId: number,
    body: {
      currentPage?: unknown;
      totalPages?: unknown;
      durationSeconds?: unknown;
      fileId?: unknown;
    },
  ) {
    const fileIdNum = body.fileId === undefined || body.fileId === null ? undefined : Number(body.fileId);
    const courseFile = await this.courseFileService.resolve(
      courseId,
      Number.isInteger(fileIdNum) && fileIdNum > 0 ? fileIdNum : undefined,
    );
    await this.courseFileService.assertFileCourseHasFiles(courseId);

    const totalPages = this.parseNonNegativeInteger(body.totalPages, 'totalPages');
    const rawCurrentPage = this.parseNonNegativeInteger(body.currentPage, 'currentPage');
    const currentPage = totalPages > 0 ? Math.min(rawCurrentPage, totalPages) : rawCurrentPage;
    const durationSeconds = Math.min(
      this.parseNonNegativeInteger(body.durationSeconds, 'durationSeconds'),
      3600,
    );

    let progress = await this.userFileCourseProgressRepository.findOne({
      where: {
        user_id: userId,
        course_id: courseId,
        course_file_id: courseFile.id,
      },
    });
    if (!progress) {
      progress = this.userFileCourseProgressRepository.create({
        user_id: userId,
        course_id: courseId,
        course_file_id: courseFile.id,
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
    return this.formatFileCourseProgress(saved, courseId, courseFile.id);
  }

  private parseNonNegativeInteger(value: unknown, field: string): number {
    const numberValue = Number(value ?? 0);
    if (!Number.isInteger(numberValue) || numberValue < 0) {
      throw new BadRequestException(`${field} 必须是非负整数`);
    }
    return numberValue;
  }

  private formatFileCourseProgress(
    progress: UserFileCourseProgress | null,
    courseId: number,
    fileId?: number,
  ) {
    return {
      courseId,
      fileId: progress?.course_file_id ?? fileId ?? null,
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

  private async loadPdfDocument(input: string | Uint8Array | ArrayBuffer): Promise<PDFDocument> {
    return PDFDocument.load(input, { ignoreEncryption: true });
  }

  private async downloadCourseFileBuffer(fileUrl: string, timeout = 30000): Promise<Buffer> {
    const cosBuffer = await this.uploadService.readCosUrlBuffer(fileUrl);
    if (cosBuffer && cosBuffer.length > 0) {
      return cosBuffer;
    }

    const res = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout,
      headers: {
        Accept:
          'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; PracticeHub/1.0)',
      },
    });
    return Buffer.from(res.data as ArrayBuffer);
  }

  /**
   * 获取课程文件预览 PDF（前 maxPages 页）。
   * Word 文件会先转换为临时 PDF，再复用 PDF 预览链路。
   */
  async getCourseFilePreviewPdf(courseId: number, maxPages: number = 3, fileId?: number): Promise<Buffer> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      select: ['id', 'content_type'],
    });
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    if (!course || course.content_type !== 'file') {
      throw new NotFoundException('课程无文件或非文件课程');
    }
    const fileType = (courseFile.file_type || '').toLowerCase();
    if (!this.isPreviewImageSupportedFileType(fileType)) {
      throw new NotFoundException('仅支持 PDF/Word 试读');
    }
    const bytes = await this.getCourseFileAsPdfBuffer(courseFile, 30000);
    const donorDoc = await this.loadPdfDocument(bytes);
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
    fileId?: number,
  ): Promise<{ totalPages: number; cacheVersion: string; fileId: number }> {
    const { course, hasAuth } = await this.getCourseAccessContext(courseId, userId);
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    if (!this.isPreviewImageSupportedFileRecord(courseFile)) {
      throw new NotFoundException('课程无可预览文件');
    }
    const fullCount = await this.resolveFullFilePageCount(courseFile);
    const totalPages =
      hasAuth || Number(course.price) === 0 || course.is_free === 1 ? fullCount : Math.min(3, fullCount);
    const previewScope =
      hasAuth || Number(course.price) === 0 || course.is_free === 1 ? 'full' : 'trial';
    return {
      totalPages: Math.max(1, totalPages),
      cacheVersion: this.getPreviewCacheVersion(courseFile.file_url, previewScope),
      fileId: courseFile.id,
    };
  }

  /**
   * 将课程文件指定页转为预览图（用于小程序内图片预览）
   * 使用 JPEG 以在尽量保持清晰度的前提下降低传输体积。
   * 依赖 pdf2pic（需系统安装 GraphicsMagick + Ghostscript），失败时抛出
   */
  async getCourseFilePreviewPageImage(
    courseId: number,
    pageNum: number,
    userId?: number,
    fileId?: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { course, hasAuth } = await this.getCourseAccessContext(courseId, userId);
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    if (!this.isPreviewImageSupportedFileRecord(courseFile)) {
      throw new NotFoundException('课程无可预览文件');
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
    const cacheKey = this.getPreviewImageCacheKey(courseId, courseFile.id, pageNum, courseFile.file_url, previewScope);
    const cached = await this.uploadService.readCosObjectBuffer(cacheKey);
    if (cached && this.isJpegBuffer(cached)) {
      return { buffer: cached, contentType: 'image/jpeg' };
    }

    const taskKey = `${courseId}:${courseFile.id}:${previewScope}:${this.getPreviewCacheVersion(courseFile.file_url, previewScope)}:${pageNum}`;
    const existingTask = this.previewRenderTasks.get(taskKey);
    if (existingTask) {
      return existingTask;
    }

    const renderTask = this.renderAndCachePreviewPage({
      course,
      courseFile,
      hasAuth,
      courseId,
      pageNum,
      cacheKey,
    }).finally(() => {
      this.previewRenderTasks.delete(taskKey);
    });
    this.previewRenderTasks.set(taskKey, renderTask);
    return renderTask;
  }

  /** 管理后台：获取文件课程前三页预览图状态 */
  async getAdminCoursePreviewSamplePages(courseId: number, fileId?: number) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    if (!this.isPreviewImageSupportedFileRecord(courseFile)) {
      return {
        supported: false,
        samplePages: [] as Array<{ pageNum: number; ready: boolean }>,
        totalPages: 0,
        fullTotalPages: 0,
        cacheVersion: '',
        fileId: courseFile.id,
      };
    }
    const fullTotalPages = await this.resolveFullFilePageCount(courseFile);
    const sampleCount = Math.min(3, Math.max(0, fullTotalPages));
    const previewScope: 'full' = 'full';
    const cacheVersion = this.getPreviewCacheVersion(courseFile.file_url, previewScope);
    const samplePages: Array<{ pageNum: number; ready: boolean }> = [];
    for (let pageNum = 1; pageNum <= sampleCount; pageNum += 1) {
      const cacheKey = this.getPreviewImageCacheKey(courseId, courseFile.id, pageNum, courseFile.file_url, previewScope);
      const ready = await this.uploadService.cosObjectExists(cacheKey);
      samplePages.push({ pageNum, ready });
    }
    return {
      supported: true,
      samplePages,
      totalPages: sampleCount,
      fullTotalPages,
      cacheVersion,
      fileId: courseFile.id,
    };
  }

  /** 管理后台：获取文件课程前三页预览图（JPEG） */
  async getAdminCoursePreviewSamplePageImage(
    courseId: number,
    pageNum: number,
    fileId?: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    if (!this.isPreviewImageSupportedFileRecord(courseFile)) {
      throw new NotFoundException('课程无可预览文件');
    }
    if (pageNum < 1 || pageNum > 3) {
      throw new NotFoundException('仅支持预览前 3 页');
    }
    const previewScope: 'full' = 'full';
    const cacheKey = this.getPreviewImageCacheKey(courseId, courseFile.id, pageNum, courseFile.file_url, previewScope);
    const cached = await this.uploadService.readCosObjectBuffer(cacheKey);
    if (cached && this.isJpegBuffer(cached)) {
      return { buffer: cached, contentType: 'image/jpeg' };
    }

    const taskKey = `admin:${courseId}:${courseFile.id}:${previewScope}:${this.getPreviewCacheVersion(courseFile.file_url, previewScope)}:${pageNum}`;
    const existingTask = this.previewRenderTasks.get(taskKey);
    if (existingTask) {
      return existingTask;
    }

    const renderTask = this.renderAndCachePreviewPage({
      course,
      courseFile,
      hasAuth: true,
      courseId,
      pageNum,
      cacheKey,
    }).finally(() => {
      this.previewRenderTasks.delete(taskKey);
    });
    this.previewRenderTasks.set(taskKey, renderTask);
    return renderTask;
  }

  warmupCoursePreviewCacheInBackground(courseId: number, force = false): { started: boolean; running: boolean; progress: PreviewWarmupProgress | null } {
    const taskKey = `${courseId}:${force ? 'force' : 'reuse'}`;
    if (this.hasRunningPreviewWarmupTask(courseId)) {
      return { started: false, running: true, progress: this.previewWarmupProgress.get(courseId) || null };
    }

    const task = this.generateCoursePreviewCache(courseId, force)
      .then((result) => {
        this.logger.log(
          `课程预览缓存生成完成 course=${courseId} generated=${result.generated} skipped=${result.skipped} failed=${result.failed} total=${result.totalPages}`,
        );
        return result;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const previous = this.previewWarmupProgress.get(courseId);
        if (previous) {
          this.updatePreviewWarmupProgress(courseId, {
            status: 'failed',
            failed: previous.failed || 1,
            errors: previous.errors?.length ? previous.errors : [{ pageNum: previous.currentPage || 0, message }],
            message,
            finishedAt: Date.now(),
          });
        }
        this.logger.error(`课程预览缓存生成失败 course=${courseId}: ${message}`);
        return {
          courseId,
          totalPages: previous?.totalPages || 0,
          generated: previous?.generated || 0,
          skipped: previous?.skipped || 0,
          failed: previous?.failed || 1,
          errors: previous?.errors?.length ? previous.errors : [{ pageNum: previous?.currentPage || 0, message }],
        };
      })
      .finally(() => {
        this.previewWarmupTasks.delete(taskKey);
      });

    this.previewWarmupTasks.set(taskKey, task);
    return { started: true, running: false, progress: this.previewWarmupProgress.get(courseId) || null };
  }

  private hasRunningPreviewWarmupTask(courseId: number) {
    return Array.from(this.previewWarmupTasks.keys()).some((key) => key.startsWith(`${courseId}:`));
  }

  getPreviewWarmupProgress(courseIds?: number[]) {
    const list = Array.from(this.previewWarmupProgress.values())
      .filter((item) => !courseIds?.length || courseIds.includes(item.courseId))
      .sort((a, b) => a.courseId - b.courseId);
    const totals = list.reduce(
      (acc, item) => {
        acc.totalCourses += 1;
        acc.totalPages += item.totalPages || 0;
        acc.generated += item.generated || 0;
        acc.skipped += item.skipped || 0;
        acc.failed += item.failed || 0;
        acc.processed += (item.generated || 0) + (item.skipped || 0) + (item.failed || 0);
        if (item.status === 'running' || item.status === 'pending') acc.runningCourses += 1;
        if (item.status === 'completed') acc.completedCourses += 1;
        if (item.status === 'failed') acc.failedCourses += 1;
        return acc;
      },
      {
        totalCourses: 0,
        runningCourses: 0,
        completedCourses: 0,
        failedCourses: 0,
        totalPages: 0,
        processed: 0,
        generated: 0,
        skipped: 0,
        failed: 0,
      },
    );
    return { ...totals, courses: list };
  }

  async generateCoursePreviewCache(
    courseId: number,
    force = false,
    onProgress?: PreviewWarmupProgressListener,
  ): Promise<PreviewWarmupResult> {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const files = await this.courseFileService.assertFileCourseHasFiles(courseId);
    const supportedFiles = files.filter((file) => this.isPreviewImageSupportedFileRecord(file));
    if (supportedFiles.length === 0) {
      throw new BadRequestException('仅文件类 PDF/Word 课程支持生成图片缓存');
    }

    const now = Date.now();
    const aggregated: PreviewWarmupResult = {
      courseId,
      totalPages: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
    this.previewWarmupProgress.set(courseId, {
      courseId,
      courseName: course.name,
      totalPages: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      status: 'pending',
      currentPage: 0,
      startedAt: now,
      updatedAt: now,
    });
    await this.notifyPreviewWarmupProgress(courseId, onProgress);

    for (const courseFile of supportedFiles) {
      this.updatePreviewWarmupProgress(courseId, {
        currentFileName: courseFile.display_name,
        status: 'running',
      });
      await this.notifyPreviewWarmupProgress(courseId, onProgress);
      const fileResult = await this.generateSingleCourseFilePreviewCache(course, courseFile, force, onProgress);
      aggregated.totalPages += fileResult.totalPages;
      aggregated.generated += fileResult.generated;
      aggregated.skipped += fileResult.skipped;
      aggregated.failed += fileResult.failed;
      aggregated.errors.push(...fileResult.errors);
    }

    this.updatePreviewWarmupProgress(courseId, {
      ...aggregated,
      currentPage: aggregated.totalPages,
      status: aggregated.failed > 0 ? 'failed' : 'completed',
      finishedAt: Date.now(),
    });
    await this.notifyPreviewWarmupProgress(courseId, onProgress);
    return aggregated;
  }

  private async generateSingleCourseFilePreviewCache(
    course: Course,
    courseFile: CourseFile,
    force: boolean,
    onProgress?: PreviewWarmupProgressListener,
  ): Promise<PreviewWarmupResult> {
    const courseId = course.id;
    const pdfBuffer = await this.getCourseFileAsPdfBuffer(courseFile, 60000);
    const doc = await this.loadPdfDocument(pdfBuffer);
    const totalPages = doc.getPageCount();
    const versionKey = this.getFilePageCountVersionKey(courseFile.file_url);
    await this.courseFileService.persistPageCount(courseFile.id, courseFile.file_url, totalPages, versionKey);
    const previewScope: 'full' = 'full';
    const result: PreviewWarmupResult = {
      courseId,
      totalPages,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
    this.updatePreviewWarmupProgress(courseId, {
      ...result,
      currentFileName: courseFile.display_name,
      status: 'running',
    });
    await this.notifyPreviewWarmupProgress(courseId, onProgress);

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      this.updatePreviewWarmupProgress(courseId, {
        currentPage: pageNum,
        currentFileName: courseFile.display_name,
        status: 'running',
      });
      await this.notifyPreviewWarmupProgress(courseId, onProgress);
      const cacheKey = this.getPreviewImageCacheKey(courseId, courseFile.id, pageNum, courseFile.file_url, previewScope);
      if (!force && (await this.uploadService.cosObjectExists(cacheKey))) {
        result.skipped += 1;
        this.updatePreviewWarmupProgress(courseId, { skipped: result.skipped });
        await this.notifyPreviewWarmupProgress(courseId, onProgress);
        continue;
      }
      try {
        await this.renderAndCachePreviewPage({
          course,
          courseFile,
          hasAuth: true,
          courseId,
          pageNum,
          cacheKey,
          pdfBufferOverride: pdfBuffer,
        });
        result.generated += 1;
        this.updatePreviewWarmupProgress(courseId, { generated: result.generated });
        await this.notifyPreviewWarmupProgress(courseId, onProgress);
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ pageNum, message: `[${courseFile.display_name}] ${message}` });
        this.updatePreviewWarmupProgress(courseId, {
          failed: result.failed,
          errors: result.errors,
          message,
        });
        await this.notifyPreviewWarmupProgress(courseId, onProgress);
        this.logger.warn(
          `课程预览缓存页生成失败 course=${courseId} file=${courseFile.id} page=${pageNum}: ${message}`,
        );
      }
      await this.sleep(20);
    }
    return result;
  }

  private async notifyPreviewWarmupProgress(courseId: number, listener?: PreviewWarmupProgressListener) {
    if (!listener) return;
    const progress = this.previewWarmupProgress.get(courseId);
    if (progress) {
      await listener(progress);
    }
  }

  private updatePreviewWarmupProgress(courseId: number, patch: Partial<PreviewWarmupProgress>) {
    const previous = this.previewWarmupProgress.get(courseId);
    if (!previous) return;
    this.previewWarmupProgress.set(courseId, {
      ...previous,
      ...patch,
      updatedAt: Date.now(),
    });
  }

  private async renderAndCachePreviewPage({
    course,
    courseFile,
    hasAuth,
    courseId,
    pageNum,
    cacheKey,
    pdfBufferOverride,
  }: {
    course: Course;
    courseFile: CourseFile;
    hasAuth: boolean;
    courseId: number;
    pageNum: number;
    cacheKey: string;
    pdfBufferOverride?: Buffer;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    let pdfBuffer: Buffer;
    if (pdfBufferOverride) {
      pdfBuffer = pdfBufferOverride;
    } else if (hasAuth || Number(course.price) === 0 || course.is_free === 1) {
      pdfBuffer = await this.getCourseFileAsPdfBuffer(courseFile, 30000);
    } else {
      pdfBuffer = await this.getCourseFilePreviewPdf(courseId, 3, courseFile.id);
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
          if (buffer && Buffer.isBuffer(buffer) && buffer.length > 8) {
            await this.assertPreviewJpegNotBlank(buffer, tmpDir);
            break;
          }
          lastError = new Error('PDF 转图未生成有效图片');
          buffer = undefined;
        } catch (error) {
          lastError = error;
          buffer = undefined;
        }
        await this.sleep(250 * attempt);
      }
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length <= 8) {
        const message = lastError instanceof Error ? lastError.message : 'PDF 转图未生成有效图片';
        throw new Error(`${message}，请确认容器已安装 Ghostscript、Poppler，并查看前置转图命令错误日志`);
      }
      await this.uploadService.uploadBufferToCOS(cacheKey, buffer, 'image/jpeg');
      this.logger.log(
        `PDF预览页生成并上传成功 course=${courseId} page=${pageNum} key=${cacheKey} size=${buffer.length} bytes`,
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

  private isPreviewImageSupportedFileRecord(file: Pick<CourseFile, 'file_url' | 'file_type'>) {
    return !!file.file_url && this.isPreviewImageSupportedFileType((file.file_type || '').toLowerCase());
  }

  private async isPreviewImageSupportedFileCourse(course: Pick<Course, 'id' | 'content_type'>) {
    if (course.content_type !== 'file') return false;
    const files = await this.courseFileService.listByCourseId(course.id);
    return files.some((file) => this.isPreviewImageSupportedFileRecord(file));
  }

  private isPreviewImageSupportedFileType(fileType?: string | null) {
    return ['pdf', 'doc', 'docx'].includes((fileType || '').toLowerCase());
  }

  private async getCourseFileAsPdfBuffer(
    file: Pick<CourseFile, 'id' | 'course_id' | 'file_url' | 'file_type'>,
    timeout = 30000,
  ): Promise<Buffer> {
    if (!file.file_url) {
      throw new NotFoundException('课程无文件');
    }
    const fileType = (file.file_type || '').toLowerCase();
    const sourceBuffer = await this.downloadCourseFileBuffer(file.file_url, timeout);
    if (fileType === 'pdf') {
      return sourceBuffer;
    }
    if (fileType === 'doc' || fileType === 'docx') {
      return this.convertWordToPdfBuffer(sourceBuffer, fileType, file.course_id);
    }
    throw new BadRequestException('暂不支持该文件类型预览');
  }

  private async convertWordToPdfBuffer(buffer: Buffer, fileType: string, courseId: number): Promise<Buffer> {
    const tmpDir = path.join(
      os.tmpdir(),
      `course-doc-to-pdf-${courseId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const profileDir = path.join(tmpDir, 'lo-profile');
    const inputPath = path.join(tmpDir, `source.${fileType}`);
    const outputPath = path.join(tmpDir, 'source.pdf');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(inputPath, buffer);

    try {
      await this.withTimeout(
        execFileAsync('soffice', [
          `-env:UserInstallation=file://${profileDir}`,
          '--headless',
          '--invisible',
          '--nodefault',
          '--nolockcheck',
          '--nologo',
          '--nofirststartwizard',
          '--convert-to',
          'pdf',
          '--outdir',
          tmpDir,
          inputPath,
        ]),
        60000,
        'Word 转 PDF 超时，请稍后重试',
      );

      if (!fs.existsSync(outputPath)) {
        throw new Error('Word 转 PDF 未生成有效文件');
      }
      const pdfBuffer = fs.readFileSync(outputPath);
      if (!pdfBuffer.length || pdfBuffer.slice(0, 4).toString() !== '%PDF') {
        throw new Error('Word 转 PDF 结果不是有效 PDF');
      }
      return pdfBuffer;
    } catch (error: any) {
      const message = error?.code === 'ENOENT'
        ? '未找到 soffice，请确认容器已安装 LibreOffice'
        : error instanceof Error
          ? error.message
          : String(error);
      throw new Error(`Word 转 PDF 失败: ${message}`);
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

  private getFilePageCountVersionKey(fileUrl: string): string {
    return this.getPreviewCacheVersion(fileUrl, 'full');
  }

  /** 优先读库内页数缓存，缺失时再下载并解析源 PDF */
  async resolveFullFilePageCount(file: CourseFile): Promise<number> {
    const versionKey = this.getFilePageCountVersionKey(file.file_url);
    const cached = this.courseFileService.getCachedPageCount(file, versionKey);
    if (cached) {
      return cached;
    }
    const bytes = await this.getCourseFileAsPdfBuffer(file, 30000);
    const doc = await this.loadPdfDocument(bytes);
    const fullCount = Math.max(0, doc.getPageCount());
    if (fullCount > 0) {
      await this.courseFileService.persistPageCount(file.id, file.file_url, fullCount, versionKey);
    }
    return fullCount;
  }

  private getPreviewImageCacheKey(
    courseId: number,
    fileId: number,
    pageNum: number,
    fileUrl: string,
    scope: 'full' | 'trial',
  ): string {
    const version = this.getPreviewCacheVersion(fileUrl, scope);
    return ['course-preview-cache', String(courseId), String(fileId), version, `${pageNum}.jpg`].join('/');
  }

  private isJpegBuffer(buffer: Buffer): boolean {
    return buffer.length > 8 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  /** 拒绝几乎全白的 JPEG，避免将无效预览图写入 COS */
  private async assertPreviewJpegNotBlank(buffer: Buffer, tmpDir: string): Promise<void> {
    const tmpPath = path.join(tmpDir, `blank-check-${Date.now()}.jpg`);
    fs.writeFileSync(tmpPath, buffer);
    try {
      const { stdout } = await execFileAsync('magick', [
        tmpPath,
        '-colorspace',
        'Gray',
        '-format',
        '%[standard-deviation]',
        'info:',
      ]);
      const std = Number.parseFloat(String(stdout).trim());
      if (Number.isFinite(std) && std < 1) {
        throw new Error('PDF 转图结果为空白页');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('空白页')) {
        throw error;
      }
      // ImageMagick 不可用时，用体积做兜底：全白 JPEG 通常远小于正常内容页
      if (buffer.length < 60000) {
        throw new Error('PDF 转图结果疑似空白页');
      }
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {}
    }
  }

  private getPreviewCacheVersion(fileUrl: string, scope: 'full' | 'trial'): string {
    return createHash('md5')
      .update(`${fileUrl}|${scope}|jpeg|${PREVIEW_IMAGE_WIDTH}|${PREVIEW_IMAGE_DENSITY}|${PREVIEW_IMAGE_QUALITY}|direct-page-v5`)
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
  async resolveCourseFile(courseId: number, fileId?: number) {
    return this.courseFileService.resolve(courseId, fileId);
  }

  async createPreviewTicket(
    courseId: number,
    userId?: number,
    fileId?: number,
  ): Promise<{ ticket: string; viewerUrl: string; fileId: number }> {
    const course = await this.courseRepository.findOne({ where: { id: courseId }, select: ['id', 'content_type'] });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const courseFile = await this.courseFileService.resolve(courseId, fileId);
    const payload = {
      courseId,
      fileId: courseFile.id,
      userId: userId ?? null,
      purpose: 'pdf-viewer',
    };
    const ticket = this.jwtService.sign(payload, { expiresIn: '5m' });
    const baseUrl = (this.configService.get('BASE_URL') || '').replace(/\/$/, '');
    const apiPrefix = baseUrl ? `${baseUrl}/api` : '/api';
    const viewerUrl = `${apiPrefix}/app/pdf-viewer?courseId=${courseId}&fileId=${courseFile.id}&ticket=${encodeURIComponent(ticket)}`;
    return { ticket, viewerUrl, fileId: courseFile.id };
  }

  /**
   * 校验预览凭证并返回 userId（用于 file-preview 接口）
   */
  verifyPreviewTicket(ticket: string): { courseId: number; fileId: number | null; userId: number | null } | null {
    try {
      const payload = this.jwtService.verify(ticket) as {
        courseId?: number;
        fileId?: number;
        userId?: number;
        purpose?: string;
      };
      if (payload.purpose !== 'pdf-viewer' || payload.courseId == null) return null;
      return {
        courseId: payload.courseId,
        fileId: Number.isInteger(payload.fileId) && payload.fileId > 0 ? payload.fileId : null,
        userId: payload.userId ?? null,
      };
    } catch {
      return null;
    }
  }
}
