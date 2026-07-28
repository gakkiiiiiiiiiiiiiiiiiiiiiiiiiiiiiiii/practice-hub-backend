import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { CourseFile } from '../../database/entities/course-file.entity';
import { CourseFileService } from './course-file.service';
import { CourseService } from './course.service';

export interface PreviewWorkerResult {
  fileId: number;
  fileUrl: string;
  pageCount: number;
  pageCountVersion: string;
}

@Injectable()
export class PreviewWorkerService {
  constructor(
    @InjectRepository(CourseFile)
    private readonly courseFileRepository: Repository<CourseFile>,
    private readonly courseFileService: CourseFileService,
    private readonly courseService: CourseService,
  ) {}

  async listJobs(cursor = 0, limit = 20) {
    const safeCursor = Number.isInteger(cursor) && cursor > 0 ? cursor : 0;
    const safeLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    const rows = await this.courseFileRepository
      .createQueryBuilder('file')
      .innerJoin(Course, 'course', 'course.id = file.course_id')
      .select([
        'file.id AS file_id',
        'file.course_id AS course_id',
        'file.display_name AS display_name',
        'file.file_url AS file_url',
        'file.file_size AS file_size',
        'file.file_page_count AS file_page_count',
        'file.file_page_count_key AS file_page_count_key',
        'course.trial_preview_page_count AS trial_preview_page_count',
      ])
      .where('file.id > :cursor', { cursor: safeCursor })
      .andWhere('file.status = 1')
      .andWhere('course.status = 1')
      .andWhere('LOWER(file.file_type) = :fileType', { fileType: 'pdf' })
      .orderBy('file.id', 'ASC')
      .limit(safeLimit + 1)
      .getRawMany();

    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit);
    const jobs = page.map((row) => {
      const fileUrl = String(row.file_url || '');
      const versions = this.courseService.getPreviewWorkerCacheVersions(fileUrl);
      const fileId = Number(row.file_id);
      const courseId = Number(row.course_id);
      const trialPages = Math.min(
        10,
        Math.max(0, Number(row.trial_preview_page_count ?? 3) || 0),
      );
      return {
        fileId,
        courseId,
        displayName: String(row.display_name || ''),
        fileUrl,
        fileSize: Number(row.file_size || 0),
        cachedPageCount: Number(row.file_page_count || 0),
        cachedPageCountVersion: String(row.file_page_count_key || ''),
        pageCountVersion: versions.pageCount,
        prewarmPages: Math.max(3, trialPages),
        fullCachePrefix: `course-preview-cache/${courseId}/${fileId}/${versions.full}`,
        trialCachePrefix: `course-preview-cache/${courseId}/${fileId}/${versions.trial}`,
      };
    });

    return {
      jobs,
      nextCursor: jobs.length > 0 ? jobs[jobs.length - 1].fileId : safeCursor,
      hasMore,
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
