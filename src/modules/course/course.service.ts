import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, QueryFailedError } from 'typeorm';
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
import { CourseType } from '../../database/entities/course-type.entity';
import { UserFileCourseProgress } from '../../database/entities/user-file-course-progress.entity';
import { UploadService } from '../upload/upload.service';
import { PackageService } from '../package/package.service';

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

export interface BlankPreviewCacheItem {
  courseId: number;
  courseName: string;
  fileId: number;
  fileName: string;
  pageNum: number;
}

export interface PreviewCacheHealthIssue {
  courseId: number;
  courseName: string;
  fileId: number;
  fileName: string;
  issue: 'missing' | 'incomplete' | 'blank';
  pageNum?: number;
  expectedPages?: number;
}

export interface PdfPageCountResult {
  pageCount: number;
  parser: 'pdf-lib' | 'pdfinfo' | 'ghostscript';
  warnings: string[];
}

export interface CourseFilePdfHealth {
  fileId: number | null;
  displayName: string;
  fileUrl: string;
  healthy: boolean;
  warnings: string[];
  pageCount: number | null;
  parser: string | null;
}

@Injectable()
export class CourseService {
  private readonly logger = new Logger(CourseService.name);
  private readonly previewRenderTasks = new Map<string, Promise<{ buffer: Buffer; contentType: string }>>();
  private readonly previewPdfDownloadTasks = new Map<string, Promise<Buffer>>();
  private readonly previewPdfBufferCache = new Map<string, { buffer: Buffer; expiresAt: number }>();
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
    @InjectRepository(CourseType)
    private courseTypeRepository: Repository<CourseType>,
    @InjectRepository(UserFileCourseProgress)
    private userFileCourseProgressRepository: Repository<UserFileCourseProgress>,
    private configService: ConfigService,
    private jwtService: JwtService,
    private uploadService: UploadService,
    private courseFileService: CourseFileService,
    private packageService: PackageService,
  ) {}

  private isMissingCourseTypeTableError(error: unknown) {
    const dbError = error as QueryFailedError & {
      code?: string;
      errno?: number;
      sqlMessage?: string;
      query?: string;
    };
    const errorText = `${dbError.message || ''} ${dbError.sqlMessage || ''} ${dbError.query || ''}`;
    return (
      error instanceof QueryFailedError &&
      (dbError.code === 'ER_NO_SUCH_TABLE' || dbError.errno === 1146) &&
      errorText.includes('course_type')
    );
  }

  private async findActiveCourseType(id: number) {
    try {
      return await this.courseTypeRepository.findOne({
        where: { id, status: 1 },
      });
    } catch (error) {
      if (this.isMissingCourseTypeTableError(error)) {
        this.logger.warn('course_type 表不存在，课程类型筛选暂不可用，请执行数据库迁移');
        return null;
      }
      throw error;
    }
  }

  private async listActiveCourseTypes() {
    try {
      return await this.courseTypeRepository.find({
        where: { status: 1 },
        order: { sort: 'ASC', id: 'ASC' },
      });
    } catch (error) {
      if (this.isMissingCourseTypeTableError(error)) {
        this.logger.warn('course_type 表不存在，课程列表将暂不附加 courseType，请执行数据库迁移');
        return [];
      }
      throw error;
    }
  }

  /**
   * 获取所有课程列表
   */
  async getAllCourses(
    keyword?: string,
    category?: string,
    subCategory?: string,
    sortBy?: string,
    userId?: number,
    courseTypeId?: number,
  ) {
    const queryBuilder = this.courseRepository.createQueryBuilder('course');
    const normalizedKeyword = String(keyword || '').trim();
    const normalizedCategory = String(category || '').trim();
    const normalizedSubCategory = String(subCategory || '').trim();
    const normalizedCourseTypeId = Number(courseTypeId) || 0;
    let hasWhere = false;

    const appendWhere = (condition: string, parameters?: Record<string, unknown>) => {
      if (hasWhere) {
        queryBuilder.andWhere(condition, parameters);
        return;
      }
      queryBuilder.where(condition, parameters);
      hasWhere = true;
    };

    // 小程序端仅展示已启用课程，与首页分类课程数统计保持一致
    appendWhere('course.status = :status', { status: 1 });

    // 关键词搜索
    if (normalizedKeyword) {
      appendWhere(
        '(course.name LIKE :keyword OR course.subject LIKE :keyword OR course.school LIKE :keyword OR course.major LIKE :keyword)',
        { keyword: `%${normalizedKeyword}%` },
      );
    }

    // 分类筛选
    if (normalizedCategory) {
      appendWhere('course.category = :category', { category: normalizedCategory });
    }

    // 二级分类筛选
    if (normalizedSubCategory) {
      appendWhere('course.sub_category = :subCategory', { subCategory: normalizedSubCategory });
    }

    let activeTypes: CourseType[] = [];
    let selectedCourseType: CourseType | null = null;
    if (normalizedCourseTypeId > 0) {
      selectedCourseType = await this.findActiveCourseType(normalizedCourseTypeId);
      if (selectedCourseType) {
        appendWhere('course.name LIKE :courseTypeKeyword', {
          courseTypeKeyword: `%${selectedCourseType.match_keyword}%`,
        });
      } else {
        appendWhere('1 = 0');
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
    activeTypes = await this.listActiveCourseTypes();
    const attachCourseType = (course: Course) => {
      const matchedType =
        selectedCourseType ||
        activeTypes.find((type) => String(course.name || '').includes(type.match_keyword)) ||
        null;
      return {
        ...course,
        courseType: matchedType
          ? {
              id: matchedType.id,
              name: matchedType.name,
              match_keyword: matchedType.match_keyword,
            }
          : null,
      };
    };
    if (!userId || courses.length === 0) {
      return courses.map((course) => ({
        ...attachCourseType(course),
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
    const packageAccessMap = await this.packageService.batchUserHasCourseAccessViaPackage(userId, courses);

    return courses.map((course) => ({
      ...attachCourseType(course),
      hasAuth:
        Number(course.price) === 0 ||
        course.is_free === 1 ||
        authMap.has(course.id) ||
        packageAccessMap.get(course.id)?.hasAccess === true,
      expireTime: authMap.get(course.id)?.expire_time || packageAccessMap.get(course.id)?.expireTime || null,
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

    if (course.content_type === 'file') {
      await this.courseFileService.ensureFromLegacyCourse(course);
    }
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

    const relatedPackageSections =
      !hasAuth && price > 0 && course.is_free !== 1
        ? await this.packageService.getRelatedSectionsForCourse(course, userId)
        : [];

    return {
      ...course,
      files: courseFiles,
      file_url: allowSourceFile ? primaryFile?.file_url || course.file_url : null,
      file_name: primaryFile?.file_name || course.file_name,
      file_display_name: primaryFile?.display_name || null,
      file_type: primaryFile?.file_type || course.file_type,
      file_size: primaryFile?.file_size ?? course.file_size,
      allow_source_file: allowSourceFile ? 1 : 0,
      chapters,
      hasAuth,
      expireTime,
      relatedPackageSections,
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
      fileName: courseFile.display_name || courseFile.file_name || `course.${fileType}`,
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
      if (!hasAuth) {
        const packageAccess = await this.packageService.userCoursePackageAccess(userId, course);
        hasAuth = packageAccess.hasAccess;
        expireTime = packageAccess.expireTime;
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

  /** 解析 PDF 页数：pdf-lib 失败时依次 fallback 到 pdfinfo、Ghostscript */
  private async resolvePdfPageCount(pdfBuffer: Buffer): Promise<PdfPageCountResult> {
    const warnings: string[] = [];

    try {
      const doc = await this.loadPdfDocument(pdfBuffer);
      const pageCount = doc.getPageCount();
      if (pageCount > 0) {
        return { pageCount, parser: 'pdf-lib', warnings };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`PDF 结构不规范（pdf-lib 无法解析）`);
      this.logger.warn(`pdf-lib 解析页数失败，尝试外部工具: ${message}`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-page-count-'));
    const pdfPath = path.join(tmpDir, 'source.pdf');
    try {
      fs.writeFileSync(pdfPath, pdfBuffer);

      const pdfinfoCount = await this.resolvePdfPageCountWithPdfinfo(pdfPath);
      if (pdfinfoCount && pdfinfoCount > 0) {
        if (warnings.length) {
          warnings.push('已使用 pdfinfo 兜底解析页数，预览仍可正常生成');
        }
        return { pageCount: pdfinfoCount, parser: 'pdfinfo', warnings };
      }

      const gsCount = await this.resolvePdfPageCountWithGhostscript(pdfPath);
      if (gsCount && gsCount > 0) {
        if (warnings.length) {
          warnings.push('已使用 Ghostscript 兜底解析页数，预览仍可正常生成');
        }
        return { pageCount: gsCount, parser: 'ghostscript', warnings };
      }

      throw new Error(warnings[0] || '无法解析 PDF 页数');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  private async resolvePdfPageCountWithPdfinfo(pdfPath: string): Promise<number | null> {
    try {
      const { stdout, stderr } = await execFileAsync('pdfinfo', [pdfPath]);
      const count = this.parsePdfinfoPageCount(`${stdout}\n${stderr}`);
      if (count) return count;
    } catch (error: any) {
      const text = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`;
      const count = this.parsePdfinfoPageCount(text);
      if (count) return count;
    }
    return null;
  }

  private parsePdfinfoPageCount(text: string): number | null {
    const match = String(text || '').match(/^Pages:\s+(\d+)/m);
    if (!match) return null;
    const count = Number.parseInt(match[1], 10);
    return Number.isInteger(count) && count > 0 ? count : null;
  }

  private async resolvePdfPageCountWithGhostscript(pdfPath: string): Promise<number | null> {
    const escapedPath = pdfPath.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    try {
      const { stdout } = await execFileAsync('gs', [
        '-q',
        '-dNODISPLAY',
        '-dNOSAFER',
        '-c',
        `(${escapedPath}) (r) file runpdfbegin pdfpagecount = quit`,
      ]);
      const count = Number.parseInt(String(stdout).trim(), 10);
      return Number.isInteger(count) && count > 0 ? count : null;
    } catch (_) {
      return null;
    }
  }

  /** 管理后台：检测课程 PDF 文件结构是否规范 */
  async inspectCourseFilePdfHealth(
    file: Pick<CourseFile, 'id' | 'course_id' | 'file_url' | 'file_type' | 'display_name'>,
  ): Promise<CourseFilePdfHealth> {
    const base: CourseFilePdfHealth = {
      fileId: file.id ?? null,
      displayName: file.display_name || '',
      fileUrl: file.file_url,
      healthy: true,
      warnings: [],
      pageCount: null,
      parser: null,
    };
    const fileType = (file.file_type || '').toLowerCase();
    if (fileType !== 'pdf') {
      return base;
    }
    if (!file.file_url) {
      return {
        ...base,
        healthy: false,
        warnings: ['文件地址为空'],
      };
    }

    try {
      const pdfBuffer = await this.getCourseFileAsPdfBuffer(file, 120000);
      const result = await this.resolvePdfPageCount(pdfBuffer);
      const exportHint = '建议用 Adobe Acrobat 或 WPS「另存为 PDF」重新导出后再上传，以避免预览异常。';
      return {
        ...base,
        healthy: result.warnings.length === 0,
        warnings:
          result.warnings.length > 0
            ? [...result.warnings, exportHint]
            : [],
        pageCount: result.pageCount,
        parser: result.parser,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        healthy: false,
        warnings: [`无法解析 PDF：${message}`, '建议重新导出 PDF 后上传。'],
      };
    }
  }

  async getAdminCourseFilesPdfHealth(courseId: number): Promise<CourseFilePdfHealth[]> {
    const files = await this.courseFileService.listByCourseId(courseId);
    const pdfFiles = files.filter((file) => (file.file_type || '').toLowerCase() === 'pdf');
    const results: CourseFilePdfHealth[] = [];
    for (const file of pdfFiles) {
      results.push(await this.inspectCourseFilePdfHealth(file));
    }
    return results;
  }

  async checkCourseFilePdfHealthByUrl(fileUrl: string, displayName?: string): Promise<CourseFilePdfHealth> {
    return this.inspectCourseFilePdfHealth({
      id: 0,
      course_id: 0,
      file_url: fileUrl,
      file_type: 'pdf',
      display_name: displayName || '',
    });
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
   * 依赖 Ghostscript / Poppler 将 PDF 页转为 JPEG，失败时抛出
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

  /** 扫描已生成但内容为空白页的预览缓存（抽样前 3 页） */
  async scanCoursesWithBlankPreviewCache(): Promise<BlankPreviewCacheItem[]> {
    const courseIds = await this.courseFileService.findCourseIdsWithPreviewableFiles();
    const blankItems: BlankPreviewCacheItem[] = [];
    const seenCourseIds = new Set<number>();

    for (const courseId of courseIds) {
      const course = await this.courseRepository.findOne({
        where: { id: courseId },
        select: ['id', 'name', 'content_type'],
      });
      if (!course) continue;

      const files = await this.courseFileService.listByCourseId(courseId);
      const supportedFiles = files.filter((file) => this.isPreviewImageSupportedFileRecord(file));
      for (const courseFile of supportedFiles) {
        const blankPageNum = await this.findBlankPreviewCachePage(course, courseFile);
        if (blankPageNum > 0 && !seenCourseIds.has(courseId)) {
          seenCourseIds.add(courseId);
          blankItems.push({
            courseId: course.id,
            courseName: course.name,
            fileId: courseFile.id,
            fileName: courseFile.display_name,
            pageNum: blankPageNum,
          });
          break;
        }
      }
    }

    return blankItems;
  }

  /** 扫描缺失首页缓存或末页未生成的课程（易导致用户预览 502） */
  async scanCoursesWithMissingOrIncompletePreviewCache(): Promise<PreviewCacheHealthIssue[]> {
    const courseIds = await this.courseFileService.findCourseIdsWithPreviewableFiles();
    const issues: PreviewCacheHealthIssue[] = [];
    const previewScope: 'full' = 'full';

    for (const courseId of courseIds) {
      const course = await this.courseRepository.findOne({
        where: { id: courseId },
        select: ['id', 'name', 'content_type'],
      });
      if (!course) continue;

      const files = await this.courseFileService.listByCourseId(courseId);
      for (const courseFile of files) {
        if (!this.isPreviewImageSupportedFileRecord(courseFile)) continue;

        const page1Key = this.getPreviewImageCacheKey(
          course.id,
          courseFile.id,
          1,
          courseFile.file_url,
          previewScope,
        );
        const page1Exists = await this.uploadService.cosObjectExists(page1Key);
        if (!page1Exists) {
          issues.push({
            courseId: course.id,
            courseName: course.name,
            fileId: courseFile.id,
            fileName: courseFile.display_name,
            issue: 'missing',
            pageNum: 1,
          });
          continue;
        }

        const versionKey = this.getFilePageCountVersionKey(courseFile.file_url);
        const cachedCount = this.courseFileService.getCachedPageCount(courseFile, versionKey);
        if (cachedCount && cachedCount > 1) {
          const lastPageKey = this.getPreviewImageCacheKey(
            course.id,
            courseFile.id,
            cachedCount,
            courseFile.file_url,
            previewScope,
          );
          const lastPageExists = await this.uploadService.cosObjectExists(lastPageKey);
          if (!lastPageExists) {
            issues.push({
              courseId: course.id,
              courseName: course.name,
              fileId: courseFile.id,
              fileName: courseFile.display_name,
              issue: 'incomplete',
              expectedPages: cachedCount,
              pageNum: cachedCount,
            });
          }
        }
      }
    }

    return issues;
  }

  /** 汇总预览缓存健康巡检结果 */
  async scanPreviewCacheHealth(): Promise<PreviewCacheHealthIssue[]> {
    const blankItems = await this.scanCoursesWithBlankPreviewCache();
    const blankIssues: PreviewCacheHealthIssue[] = blankItems.map((item) => ({
      courseId: item.courseId,
      courseName: item.courseName,
      fileId: item.fileId,
      fileName: item.fileName,
      issue: 'blank',
      pageNum: item.pageNum,
    }));
    const blankCourseIds = new Set(blankIssues.map((item) => item.courseId));
    const otherIssues = (await this.scanCoursesWithMissingOrIncompletePreviewCache()).filter(
      (item) => !blankCourseIds.has(item.courseId),
    );
    return [...blankIssues, ...otherIssues];
  }

  private async findBlankPreviewCachePage(course: Course, courseFile: CourseFile): Promise<number> {
    const previewScope: 'full' = 'full';
    for (let pageNum = 1; pageNum <= 3; pageNum += 1) {
      const cacheKey = this.getPreviewImageCacheKey(
        course.id,
        courseFile.id,
        pageNum,
        courseFile.file_url,
        previewScope,
      );
      if (!(await this.uploadService.cosObjectExists(cacheKey))) {
        continue;
      }
      const buffer = await this.uploadService.readCosObjectBuffer(cacheKey);
      if (!buffer || !this.isJpegBuffer(buffer)) {
        continue;
      }
      if (await this.isPreviewJpegBlank(buffer)) {
        return pageNum;
      }
    }
    return 0;
  }

  private async generateSingleCourseFilePreviewCache(
    course: Course,
    courseFile: CourseFile,
    force: boolean,
    onProgress?: PreviewWarmupProgressListener,
  ): Promise<PreviewWarmupResult> {
    const courseId = course.id;
    const pdfBuffer = await this.getCourseFileAsPdfBuffer(courseFile, 120000);
    const { pageCount: totalPages, warnings: pageCountWarnings } = await this.resolvePdfPageCount(pdfBuffer);
    if (pageCountWarnings.length) {
      this.logger.warn(
        `课程 ${courseId} 文件 ${courseFile.id} 页数解析警告: ${pageCountWarnings.join('; ')}`,
      );
    }
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
    } else {
      pdfBuffer = await this.resolvePreviewPdfBuffer({
        course,
        courseFile,
        hasAuth,
        courseId,
      });
    }

    const tmpDir = path.join(os.tmpdir(), `course-preview-${courseId}-${pageNum}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, 'doc.pdf');
    try {
      fs.writeFileSync(pdfPath, pdfBuffer);
      let buffer = await this.renderPdfPageToJpeg(pdfPath, pageNum, tmpDir);
      if (!buffer || (await this.isPreviewJpegBlank(buffer, tmpDir))) {
        const pageText = await this.extractPdfPageText(pdfPath, pageNum);
        if (!pageText.trim()) {
          this.logger.warn(
            `PDF 第 ${pageNum} 页无文本且各引擎转图为空白，按空页写入占位图 course=${courseId} file=${courseFile.id}`,
          );
          buffer = await this.createBlankPagePlaceholderJpeg(tmpDir);
        } else if (!buffer) {
          throw new Error(
            'PDF 转图未生成有效图片（该页含文本但无法渲染），建议用 Adobe Acrobat 或 WPS 重新导出 PDF',
          );
        } else {
          throw new Error(
            'PDF 转图结果为空白页（该页含文本但无法渲染），建议用 Adobe Acrobat 或 WPS 重新导出 PDF',
          );
        }
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

  private async resolvePreviewPdfBuffer({
    course,
    courseFile,
    hasAuth,
    courseId,
  }: {
    course: Course;
    courseFile: CourseFile;
    hasAuth: boolean;
    courseId: number;
  }): Promise<Buffer> {
    const cacheKey = `${courseId}:${courseFile.id}:${courseFile.file_url || ''}`;
    const cached = this.previewPdfBufferCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.buffer;
    }

    const existingTask = this.previewPdfDownloadTasks.get(cacheKey);
    if (existingTask) {
      return existingTask;
    }

    const downloadTask = (async () => {
      let pdfBuffer: Buffer;
      if (hasAuth || Number(course.price) === 0 || course.is_free === 1) {
        pdfBuffer = await this.getCourseFileAsPdfBuffer(courseFile, 60000);
      } else {
        pdfBuffer = await this.getCourseFilePreviewPdf(courseId, 3, courseFile.id);
      }
      this.previewPdfBufferCache.set(cacheKey, {
        buffer: pdfBuffer,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return pdfBuffer;
    })().finally(() => {
      this.previewPdfDownloadTasks.delete(cacheKey);
    });

    this.previewPdfDownloadTasks.set(cacheKey, downloadTask);
    return downloadTask;
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
    const renderers: Array<{ name: string; run: () => Promise<Buffer | undefined> }> = [
      { name: 'mutool', run: () => this.renderPdfPageWithMutool(pdfPath, pageNum, tmpDir) },
      { name: 'pdftocairo', run: () => this.renderPdfPageWithPdftocairo(pdfPath, pageNum, tmpDir) },
      { name: 'pdftoppm', run: () => this.renderPdfPageWithPoppler(pdfPath, pageNum, tmpDir) },
      { name: 'ghostscript', run: () => this.renderPdfPageWithGhostscript(pdfPath, pageNum, tmpDir, false) },
      { name: 'ghostscript-nosafer', run: () => this.renderPdfPageWithGhostscript(pdfPath, pageNum, tmpDir, true) },
    ];

    for (const renderer of renderers) {
      const buffer = await renderer.run();
      if (!buffer || buffer.length <= 8) {
        continue;
      }
      if (!(await this.isPreviewJpegBlank(buffer, tmpDir))) {
        this.logger.debug(`PDF 第 ${pageNum} 页由 ${renderer.name} 渲染成功`);
        return buffer;
      }
      this.logger.warn(`PDF 第 ${pageNum} 页 ${renderer.name} 转图结果为空白，尝试下一个引擎`);
    }

    return undefined;
  }

  private async extractPdfPageText(pdfPath: string, pageNum: number): Promise<string> {
    try {
      const { stdout } = await execFileAsync('pdftotext', [
        '-f',
        String(pageNum),
        '-l',
        String(pageNum),
        pdfPath,
        '-',
      ]);
      return String(stdout || '').replace(/\s+/g, ' ').trim();
    } catch (_) {
      return '';
    }
  }

  private async createBlankPagePlaceholderJpeg(tmpDir: string): Promise<Buffer> {
    const outPath = path.join(tmpDir, 'blank-placeholder.jpg');
    const height = Math.round(PREVIEW_IMAGE_WIDTH * 1.414);
    await execFileAsync('magick', [
      '-size',
      `${PREVIEW_IMAGE_WIDTH}x${height}`,
      'xc:#ffffff',
      '-quality',
      String(PREVIEW_IMAGE_QUALITY),
      outPath,
    ]);
    const buffer = fs.readFileSync(outPath);
    if (!buffer.length) {
      throw new Error('空页占位图生成失败');
    }
    return buffer;
  }

  private async renderPdfPageWithMutool(
    pdfPath: string,
    pageNum: number,
    tmpDir: string,
  ): Promise<Buffer | undefined> {
    const pngPath = path.join(tmpDir, `mutool-page-${pageNum}.png`);
    const jpegPath = path.join(tmpDir, `mutool-page-${pageNum}.jpg`);
    try {
      await this.withTimeout(
        execFileAsync('mutool', [
          'draw',
          '-r',
          String(PREVIEW_IMAGE_DENSITY),
          '-o',
          pngPath,
          pdfPath,
          String(pageNum),
        ]),
        45000,
        'mutool 预览图生成超时，请稍后重试',
      );
      if (!fs.existsSync(pngPath)) return undefined;
      await execFileAsync('magick', [
        pngPath,
        '-quality',
        String(PREVIEW_IMAGE_QUALITY),
        jpegPath,
      ]);
      if (!fs.existsSync(jpegPath)) return undefined;
      const buffer = fs.readFileSync(jpegPath);
      return buffer.length > 8 ? buffer : undefined;
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PDF预览] mutool 转图失败:', stderr || message);
      return undefined;
    }
  }

  private async renderPdfPageWithPdftocairo(
    pdfPath: string,
    pageNum: number,
    tmpDir: string,
  ): Promise<Buffer | undefined> {
    const outputPrefix = path.join(tmpDir, `cairo-page-${pageNum}`);
    const outputPath = `${outputPrefix}.jpg`;
    try {
      await this.withTimeout(
        execFileAsync('pdftocairo', [
          '-jpeg',
          '-f',
          String(pageNum),
          '-l',
          String(pageNum),
          '-singlefile',
          '-scale-to-x',
          String(PREVIEW_IMAGE_WIDTH),
          pdfPath,
          outputPrefix,
        ]),
        45000,
        'pdftocairo 预览图生成超时，请稍后重试',
      );
      if (!fs.existsSync(outputPath)) return undefined;
      const buffer = fs.readFileSync(outputPath);
      return buffer.length > 8 ? buffer : undefined;
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PDF预览] pdftocairo 转图失败:', stderr || message);
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

  private async renderPdfPageWithGhostscript(
    pdfPath: string,
    pageNum: number,
    tmpDir: string,
    noSafer = false,
  ): Promise<Buffer | undefined> {
    const outputPath = path.join(tmpDir, `page-${pageNum}${noSafer ? '-ns' : ''}.jpg`);
    try {
      await this.withTimeout(
        execFileAsync('gs', [
          noSafer ? '-dNOSAFER' : '-dSAFER',
          '-dBATCH',
          '-dNOPAUSE',
          '-dPDFSTOPONERROR=false',
          '-dUseCropBox',
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
      console.error(`[PDF预览] Ghostscript 转图失败${noSafer ? ' (NOSAFER)' : ''}:`, stderr || message);
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
    const bytes = await this.getCourseFileAsPdfBuffer(file, 120000);
    const { pageCount: fullCount, warnings } = await this.resolvePdfPageCount(bytes);
    if (warnings.length) {
      this.logger.warn(`课程文件 ${file.id} 页数解析警告: ${warnings.join('; ')}`);
    }
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
  private async isPreviewJpegBlank(buffer: Buffer, tmpDir?: string): Promise<boolean> {
    if (!this.isJpegBuffer(buffer)) {
      return false;
    }
    const workDir = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'preview-blank-'));
    const shouldCleanupDir = !tmpDir;
    const tmpPath = path.join(workDir, `blank-check-${Date.now()}.jpg`);
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
      if (Number.isFinite(std) && std < 0.8) {
        return true;
      }
      return false;
    } catch (_) {
      // ImageMagick 不可用时，用体积做兜底：全白 JPEG 通常远小于正常内容页
      return buffer.length < 45000;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {}
      if (shouldCleanupDir) {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch (_) {}
      }
    }
  }

  private getPreviewCacheVersion(fileUrl: string, scope: 'full' | 'trial'): string {
    return createHash('md5')
      .update(`${fileUrl}|${scope}|jpeg|${PREVIEW_IMAGE_WIDTH}|${PREVIEW_IMAGE_DENSITY}|${PREVIEW_IMAGE_QUALITY}|direct-page-v7`)
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
