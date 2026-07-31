import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { CourseFile } from '../../database/entities/course-file.entity';
import { SystemConfig } from '../../database/entities/system-config.entity';
import { CourseFileService } from './course-file.service';
import { CourseService } from './course.service';
import { UploadService } from '../upload/upload.service';

export interface PreviewWorkerResult {
  fileId: number;
  fileUrl: string;
  pageCount: number;
  pageCountVersion: string;
}

export interface PreviewWorkerUploadRequest {
  fileId: number;
  fileUrl: string;
  pageCountVersion: string;
  pageNum: number;
  workerProvider?: 'oss' | 'cos';
}

@Injectable()
export class PreviewWorkerService {
  private skippedFileIdsCache: { ids: number[]; expiresAt: number } | null = null;
  private readonly sourceProviderCache = new Map<
    string,
    { provider: 'oss' | 'cos' | null; expiresAt: number }
  >();

  constructor(
    @InjectRepository(CourseFile)
    private readonly courseFileRepository: Repository<CourseFile>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
    private readonly courseFileService: CourseFileService,
    private readonly courseService: CourseService,
    private readonly uploadService: UploadService,
  ) {}

  private async getSkippedFileIds() {
    if (this.skippedFileIdsCache && this.skippedFileIdsCache.expiresAt > Date.now()) {
      return this.skippedFileIdsCache.ids;
    }
    const config = await this.systemConfigRepository.findOne({
      where: { configKey: 'preview_worker_skipped_files' },
      select: ['configValue'],
    });
    let ids: number[] = [];
    try {
      const parsed = JSON.parse(config?.configValue || '{}');
      const files = Array.isArray(parsed) ? parsed : parsed?.files;
      if (Array.isArray(files)) {
        ids = Array.from(
          new Set(
            files
              .map((item) => Number(typeof item === 'object' ? item?.fileId : item))
              .filter((fileId) => Number.isInteger(fileId) && fileId > 0),
          ),
        );
      }
    } catch {}
    this.skippedFileIdsCache = {
      ids,
      expiresAt: Date.now() + 30_000,
    };
    return ids;
  }

  private getFullPreviewDemandSql(courseAlias = 'course') {
    return `(
      ${courseAlias}.is_free = 1
      OR ${courseAlias}.price = 0
      OR EXISTS (
        SELECT 1
        FROM user_course_auth course_auth
        WHERE course_auth.course_id = ${courseAlias}.id
          AND (
            course_auth.expire_time IS NULL
            OR course_auth.expire_time > NOW()
          )
      )
      OR EXISTS (
        SELECT 1
        FROM user_package_subscription ups
        INNER JOIN package_section ps
          ON ps.id = ups.section_id
          AND ps.status = 1
        INNER JOIN package_section_scope pss
          ON pss.section_id = ps.id
        WHERE ups.expire_time > NOW()
          AND (
            pss.scope_type = 'all'
            OR (
            pss.scope_type = 'course'
              AND CAST(TRIM(pss.scope_value) AS UNSIGNED) = ${courseAlias}.id
            )
            OR (
              pss.scope_type = 'category'
              AND TRIM(pss.scope_value) COLLATE utf8mb4_unicode_ci
                = TRIM(COALESCE(${courseAlias}.category, ''))
            )
            OR (
              pss.scope_type = 'sub_category'
              AND TRIM(pss.scope_value) COLLATE utf8mb4_unicode_ci
                = TRIM(COALESCE(${courseAlias}.sub_category, ''))
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM user_category_bundle_access category_access
        INNER JOIN course_category bundle_category
          ON bundle_category.id = category_access.category_id
        LEFT JOIN course_category parent_category
          ON parent_category.id = bundle_category.parent_id
        WHERE TRIM(COALESCE(${courseAlias}.category, '')) COLLATE utf8mb4_unicode_ci
          = TRIM(CASE
              WHEN bundle_category.parent_id IS NULL THEN bundle_category.name
              ELSE COALESCE(parent_category.name, '')
            END) COLLATE utf8mb4_unicode_ci
          AND (
            bundle_category.parent_id IS NULL
            OR TRIM(COALESCE(${courseAlias}.sub_category, '')) COLLATE utf8mb4_unicode_ci
              = TRIM(bundle_category.name) COLLATE utf8mb4_unicode_ci
          )
      )
    )`;
  }

  private async hasFullPreviewDemand(courseId: number) {
    const row = await this.courseFileRepository.manager
      .getRepository(Course)
      .createQueryBuilder('course')
      .select(
        `CASE WHEN ${this.getFullPreviewDemandSql('course')} THEN 1 ELSE 0 END`,
        'full_preview_eligible',
      )
      .where('course.id = :courseId', { courseId })
      .getRawOne();
    return Number(row?.full_preview_eligible || 0) === 1;
  }

  private async resolveSourceProvider(fileUrl: string, fileId: number) {
    // 阿里云节点保持 2 并发、腾讯云节点提升至 8 并发，因此对双端均有副本的
    // 历史文件按 2:8 稳定分流。单端文件会自动回退到实际存在的存储服务。
    const preferredProvider: 'oss' | 'cos' = fileId % 5 === 0 ? 'oss' : 'cos';
    const cacheKey = `${fileId}:${String(fileUrl || '')}`;
    const cached = this.sourceProviderCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.provider;
    const provider = await this.uploadService.resolvePreviewWorkerSource(
      fileUrl,
      preferredProvider,
    );
    if (this.sourceProviderCache.size >= 10_000) {
      this.sourceProviderCache.clear();
    }
    this.sourceProviderCache.set(cacheKey, {
      provider,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return provider;
  }

  async listJobs(
    cursor = 0,
    limit = 20,
    workerProvider: 'oss' | 'cos' = 'oss',
    publicSource = false,
  ) {
    const safeCursor = Number.isInteger(cursor) && cursor > 0 ? cursor : 0;
    const safeLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    const targetProvider = workerProvider === 'cos' ? 'cos' : 'oss';
    const skippedFileIds = await this.getSkippedFileIds();
    const batchSize = Math.max(50, safeLimit);
    const page: Array<{ row: any; sourceProvider: 'oss' | 'cos' }> = [];
    let scanCursor = safeCursor;
    let hasMore = true;

    while (page.length < safeLimit && hasMore) {
      const rows = await this.courseFileRepository
        .createQueryBuilder('file')
        .innerJoin(Course, 'course', 'course.id = file.course_id')
        .select([
          'file.id AS file_id',
          'file.course_id AS course_id',
          'file.display_name AS display_name',
          'file.file_url AS file_url',
          'file.file_type AS file_type',
          'file.file_size AS file_size',
          'file.file_page_count AS file_page_count',
          'file.file_page_count_key AS file_page_count_key',
          'file.full_preview_requested AS full_preview_requested',
          'course.trial_preview_page_count AS trial_preview_page_count',
        ])
        .addSelect(
          `CASE WHEN ${this.getFullPreviewDemandSql('course')} THEN 1 ELSE 0 END`,
          'full_preview_eligible',
        )
        .where('file.id > :cursor', { cursor: scanCursor })
        .andWhere('file.status = 1')
        .andWhere('course.status = 1')
        .andWhere(
          skippedFileIds.length > 0
            ? 'file.id NOT IN (:...skippedFileIds)'
            : '1 = 1',
          skippedFileIds.length > 0 ? { skippedFileIds } : {},
        )
        .andWhere('LOWER(file.file_type) IN (:...fileTypes)', {
          fileTypes: ['pdf', 'doc', 'docx'],
        })
        .orderBy('file.id', 'ASC')
        .limit(batchSize)
        .getRawMany();

      if (rows.length === 0) {
        hasMore = false;
        break;
      }
      const resolvedProviders: Array<'oss' | 'cos' | null> = [];
      for (let index = 0; index < rows.length; index += 10) {
        resolvedProviders.push(
          ...(await Promise.all(
            rows
              .slice(index, index + 10)
              .map((row) =>
                this.resolveSourceProvider(
                  String(row.file_url || ''),
                  Number(row.file_id),
                ),
              ),
          )),
        );
      }
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        scanCursor = Number(row.file_id) || scanCursor;
        const sourceProvider = resolvedProviders[index];
        if (sourceProvider === targetProvider) {
          page.push({ row, sourceProvider });
          if (page.length >= safeLimit) break;
        }
      }
      if (page.length >= safeLimit) {
        hasMore = true;
      } else {
        hasMore = rows.length === batchSize;
      }
    }

    const jobs = await Promise.all(page.map(async ({ row, sourceProvider }) => {
      const fileUrl = String(row.file_url || '');
      const versions = this.courseService.getPreviewWorkerCacheVersions(fileUrl);
      const fileId = Number(row.file_id);
      const courseId = Number(row.course_id);
      const trialPages = Math.min(
        50,
        Math.max(0, Number(row.trial_preview_page_count ?? 3) || 0),
      );
      const cachedPageCount = Number(row.file_page_count || 0);
      const pageCountVersionMatches =
        cachedPageCount > 0 &&
        String(row.file_page_count_key || '') === versions.pageCount;
      let cacheComplete = false;
      let fullCacheComplete = false;
      let trialCacheComplete = trialPages < 1;
      if (pageCountVersionMatches) {
        fullCacheComplete = await this.uploadService.previewCacheObjectExists(
          `course-preview-cache/${courseId}/${fileId}/${versions.full}/${cachedPageCount}.jpg`,
        );
        if (trialPages > 0) {
          trialCacheComplete = await this.uploadService.previewCacheObjectExists(
            `course-preview-cache/${courseId}/${fileId}/${versions.trial}/${Math.min(trialPages, cachedPageCount)}.jpg`,
          );
        }
        cacheComplete = fullCacheComplete && trialCacheComplete;
      }
      const uploadRequested = Number(row.full_preview_requested || 0) === 1;
      if (uploadRequested && fullCacheComplete) {
        await this.courseFileRepository.update(fileId, {
          full_preview_requested: 0,
        });
      }
      const fullPreviewEligible =
        Number(row.full_preview_eligible || 0) === 1 ||
        (uploadRequested && !fullCacheComplete);
      return {
        fileId,
        courseId,
        displayName: String(row.display_name || ''),
        fileUrl,
        fileType: String(row.file_type || '').toLowerCase(),
        fileSize: Number(row.file_size || 0),
        cachedPageCount,
        cachedPageCountVersion: String(row.file_page_count_key || ''),
        pageCountVersion: versions.pageCount,
        trialPages,
        sourceProvider,
        fullPreviewEligible,
        fullPreviewRequested: uploadRequested && !fullCacheComplete,
        cacheComplete,
        fullCacheComplete,
        trialCacheComplete,
        fullCachePrefix: `course-preview-cache/${courseId}/${fileId}/${versions.full}`,
        trialCachePrefix: `course-preview-cache/${courseId}/${fileId}/${versions.trial}`,
        sourceUrl: await this.uploadService.getPreviewWorkerDownloadUrl(
          fileUrl,
          sourceProvider,
          publicSource,
        ),
      };
    }));

    return {
      jobs,
      nextCursor: jobs.length > 0 ? jobs[jobs.length - 1].fileId : scanCursor,
      hasMore,
      workerProvider: targetProvider,
    };
  }

  async getUploadUrls(input: PreviewWorkerUploadRequest) {
    const fileId = Number(input.fileId);
    const pageNum = Number(input.pageNum);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new BadRequestException('fileId 无效');
    }
    if (!Number.isInteger(pageNum) || pageNum <= 0 || pageNum > 20000) {
      throw new BadRequestException('pageNum 无效');
    }

    const file = await this.courseFileRepository.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException('课程文件不存在');
    if (file.file_url !== input.fileUrl) {
      throw new BadRequestException('课程文件已被替换');
    }
    const versions = this.courseService.getPreviewWorkerCacheVersions(file.file_url);
    if (versions.pageCount !== input.pageCountVersion) {
      throw new BadRequestException('课程文件版本不匹配');
    }

    const course = await this.courseFileRepository.manager
      .getRepository(Course)
      .findOne({ where: { id: file.course_id }, select: ['id', 'trial_preview_page_count'] });
    if (!course) throw new NotFoundException('课程不存在');
    const trialPages = Math.min(
      50,
      Math.max(0, Number(course.trial_preview_page_count ?? 3) || 0),
    );
    if (
      pageNum > trialPages &&
      Number(file.full_preview_requested || 0) !== 1 &&
      !(await this.hasFullPreviewDemand(course.id))
    ) {
      throw new BadRequestException('该课程暂无完整预览生成需求');
    }
    const keys = [
      `course-preview-cache/${file.course_id}/${file.id}/${versions.full}/${pageNum}.jpg`,
    ];
    if (pageNum <= trialPages) {
      keys.push(
        `course-preview-cache/${file.course_id}/${file.id}/${versions.trial}/${pageNum}.jpg`,
      );
    }
    return {
      fileId: file.id,
      pageNum,
      uploads: await Promise.all(
        keys.map(async (key) => ({
          ...this.uploadService.getPreviewWorkerUploadUrl(
            key,
            'image/jpeg',
            input.workerProvider === 'cos' ? 'public' : 'internal',
          ),
          exists: await this.uploadService.previewCacheObjectExists(key),
        })),
      ),
    };
  }

  async reportResult(input: PreviewWorkerResult) {
    const fileId = Number(input.fileId);
    const pageCount = Number(input.pageCount);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new BadRequestException('fileId 无效');
    }
    if (!Number.isInteger(pageCount) || pageCount <= 0 || pageCount > 20000) {
      throw new BadRequestException('pageCount 无效');
    }

    const file = await this.courseFileRepository.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException('课程文件不存在');
    if (file.file_url !== input.fileUrl) {
      throw new BadRequestException('课程文件已被替换，本次结果已忽略');
    }

    const expectedVersion = this.courseService.getPreviewWorkerCacheVersions(
      file.file_url,
    ).pageCount;
    if (expectedVersion !== input.pageCountVersion) {
      throw new BadRequestException('课程文件版本不匹配');
    }

    await this.courseFileService.persistPageCount(
      file.id,
      file.file_url,
      pageCount,
      expectedVersion,
    );
    return {
      accepted: true,
      fileId: file.id,
      courseId: file.course_id,
      pageCount,
    };
  }
}
