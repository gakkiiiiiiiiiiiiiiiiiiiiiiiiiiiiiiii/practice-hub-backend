import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { CourseFile } from '../../database/entities/course-file.entity';
import { UploadService } from '../upload/upload.service';
import { StorageCleanupService } from '../storage-cleanup/storage-cleanup.service';

export type CourseFileInput = {
  display_name: string;
  file_url: string;
  file_name?: string | null;
  file_type: string;
  file_size?: number;
  sort?: number;
};

@Injectable()
export class CourseFileService {
  constructor(
    @InjectRepository(CourseFile)
    private readonly courseFileRepository: Repository<CourseFile>,
    @InjectRepository(Course)
    private readonly courseRepository: Repository<Course>,
    private readonly dataSource: DataSource,
    private readonly uploadService: UploadService,
    private readonly storageCleanupService: StorageCleanupService,
  ) {}

  stripFileExtension(name?: string | null): string {
    const base = String(name || '').trim();
    return base.replace(/\.(pdf|docx?)$/i, '') || base;
  }

  async ensureFromLegacyCourse(
    course: Pick<Course, 'id' | 'content_type' | 'file_url' | 'file_name' | 'file_type' | 'file_size' | 'name'>,
  ): Promise<void> {
    if (course.content_type !== 'file') return;
    const files = await this.listByCourseId(course.id);
    if (files.length > 0) return;
    const fileUrl = String(course.file_url || '').trim();
    if (!fileUrl) return;
    await this.create(course.id, {
      display_name: this.stripFileExtension(course.file_name) || course.name || '课程文件',
      file_url: fileUrl,
      file_name: course.file_name,
      file_type: (course.file_type || 'pdf').toLowerCase(),
      file_size: Number(course.file_size || 0),
      sort: 0,
    });
  }

  async listByCourseId(courseId: number): Promise<CourseFile[]> {
    return this.courseFileRepository.find({
      where: { course_id: courseId, status: 1 },
      order: { sort: 'ASC', id: 'ASC' },
    });
  }

  async findCourseIdsWithPreviewableFiles(): Promise<number[]> {
    const rows = await this.courseFileRepository
      .createQueryBuilder('cf')
      .innerJoin(Course, 'c', 'c.id = cf.course_id AND c.content_type = :contentType', {
        contentType: 'file',
      })
      .where('cf.status = 1')
      .andWhere('LOWER(cf.file_type) IN (:...types)', {
        types: ['pdf', 'doc', 'docx'],
      })
      .select('DISTINCT cf.course_id', 'courseId')
      .orderBy('cf.course_id', 'ASC')
      .getRawMany<{ courseId: string }>();
    return rows.map((row) => Number(row.courseId)).filter((id) => id > 0);
  }

  async resolve(courseId: number, fileId?: number): Promise<CourseFile> {
    if (fileId) {
      const file = await this.courseFileRepository.findOne({
        where: { id: fileId, course_id: courseId, status: 1 },
      });
      if (!file) {
        throw new NotFoundException('课程文件不存在');
      }
      return file;
    }
    const files = await this.listByCourseId(courseId);
    if (files.length === 0) {
      throw new NotFoundException('课程无文件');
    }
    return files[0];
  }

  async assertFileCourseHasFiles(courseId: number): Promise<CourseFile[]> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      select: ['id', 'content_type'],
    });
    if (!course || course.content_type !== 'file') {
      throw new NotFoundException('课程无文件或非文件课程');
    }
    const files = await this.listByCourseId(courseId);
    if (files.length === 0) {
      throw new NotFoundException('课程无文件');
    }
    return files;
  }

  async syncPrimaryMirror(courseId: number, manager?: EntityManager): Promise<void> {
    const courseRepository = manager ? manager.getRepository(Course) : this.courseRepository;
    const courseFileRepository = manager ? manager.getRepository(CourseFile) : this.courseFileRepository;
    const course = await courseRepository.findOne({ where: { id: courseId } });
    if (!course) return;
    const files = await courseFileRepository.find({
      where: { course_id: courseId, status: 1 },
      order: { sort: 'ASC', id: 'ASC' },
    });
    if (files.length === 0) {
      course.file_url = null;
      course.file_name = null;
      course.file_type = null;
      course.file_size = 0;
      course.file_page_count = null;
      course.file_page_count_key = null;
      await courseRepository.save(course);
      return;
    }
    const primary = files[0];
    course.file_url = primary.file_url;
    course.file_name = primary.file_name;
    course.file_type = primary.file_type;
    course.file_size = Number(primary.file_size || 0);
    course.file_page_count = primary.file_page_count;
    course.file_page_count_key = primary.file_page_count_key;
    await courseRepository.save(course);
  }

  private async getNextSort(courseId: number, manager?: EntityManager): Promise<number> {
    const repository = manager ? manager.getRepository(CourseFile) : this.courseFileRepository;
    const row = await repository
      .createQueryBuilder('cf')
      .select('MAX(cf.sort)', 'maxSort')
      .where('cf.course_id = :courseId', { courseId })
      .getRawOne<{ maxSort: string | null }>();
    return (Number(row?.maxSort) || 0) + 1;
  }

  async create(courseId: number, input: CourseFileInput): Promise<CourseFile> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (course.content_type !== 'file') {
      throw new BadRequestException('仅文件课程可添加附件');
    }
    const displayName = String(input.display_name || '').trim();
    const sourceFileUrl = String(input.file_url || '').trim();
    const fileType = String(input.file_type || '')
      .trim()
      .toLowerCase();
    if (!displayName) {
      throw new BadRequestException('请填写文件展示名称');
    }
    if (!sourceFileUrl) {
      throw new BadRequestException('文件地址不能为空');
    }
    if (!['pdf', 'doc', 'docx'].includes(fileType)) {
      throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
    }
    const promoted = await this.uploadService.promoteCourseFileUrl(sourceFileUrl);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(CourseFile);
        const entity = repository.create({
          course_id: courseId,
          display_name: displayName.slice(0, 255),
          file_url: promoted.url,
          file_name: input.file_name || null,
          file_type: fileType,
          file_size: Number(input.file_size || 0),
          sort: Number.isInteger(input.sort) ? Number(input.sort) : await this.getNextSort(courseId, manager),
          status: 1,
        });
        const saved = await repository.save(entity);
        await this.syncPrimaryMirror(courseId, manager);
        return saved;
      });
    } catch (error) {
      if (promoted.promoted) {
        await this.storageCleanupService.enqueueUrls([promoted.url], 'course_file_create_rollback', undefined, 0);
      }
      throw error;
    }
  }

  async update(
    courseId: number,
    fileId: number,
    patch: Partial<Pick<CourseFileInput, 'display_name' | 'sort'>> & {
      file_url?: string;
      file_name?: string | null;
      file_type?: string;
      file_size?: number;
    },
  ): Promise<CourseFile> {
    const before = await this.resolve(courseId, fileId);
    let promoted: { url: string; promoted: boolean } | null = null;
    if (patch.file_url !== undefined) {
      const nextUrl = String(patch.file_url || '').trim();
      if (!nextUrl) throw new BadRequestException('文件地址不能为空');
      if (nextUrl !== before.file_url) promoted = await this.uploadService.promoteCourseFileUrl(nextUrl);
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(CourseFile);
        const file = await repository.findOne({
          where: { id: fileId, course_id: courseId, status: 1 },
        });
        if (!file) throw new NotFoundException('课程文件不存在');
        const previousUrl = file.file_url;
        if (patch.display_name !== undefined) {
          const displayName = String(patch.display_name || '').trim();
          if (!displayName) throw new BadRequestException('请填写文件展示名称');
          file.display_name = displayName.slice(0, 255);
        }
        if (patch.sort !== undefined) file.sort = Number(patch.sort) || 0;
        if (promoted) {
          if (promoted.url !== file.file_url) {
            file.file_page_count = null;
            file.file_page_count_key = null;
          }
          file.file_url = promoted.url;
        }
        if (patch.file_name !== undefined) file.file_name = patch.file_name;
        if (patch.file_type !== undefined) {
          const fileType = String(patch.file_type || '')
            .trim()
            .toLowerCase();
          if (!['pdf', 'doc', 'docx'].includes(fileType)) {
            throw new BadRequestException('仅支持 PDF、Word（.doc/.docx）文件');
          }
          file.file_type = fileType;
        }
        if (patch.file_size !== undefined) file.file_size = Number(patch.file_size || 0);
        const saved = await repository.save(file);
        await this.syncPrimaryMirror(courseId, manager);
        if (promoted && previousUrl !== promoted.url) {
          await this.storageCleanupService.enqueueUrls([previousUrl], 'course_file_replaced', manager);
        }
        return saved;
      });
    } catch (error) {
      if (promoted?.promoted) {
        await this.storageCleanupService.enqueueUrls([promoted.url], 'course_file_update_rollback', undefined, 0);
      }
      throw error;
    }
  }

  async remove(courseId: number, fileId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CourseFile);
      const file = await repository.findOne({
        where: { id: fileId, course_id: courseId },
      });
      if (!file) throw new NotFoundException('课程文件不存在');
      await repository.remove(file);
      await this.syncPrimaryMirror(courseId, manager);
      await this.storageCleanupService.enqueueUrls([file.file_url], 'course_file_deleted', manager);
    });
  }

  async removeAllForCourse(courseId: number, manager: EntityManager, legacyFileUrl?: string | null): Promise<string[]> {
    const repository = manager.getRepository(CourseFile);
    const files = await repository.find({ where: { course_id: courseId } });
    const urls = Array.from(
      new Set([...files.map((file) => file.file_url), legacyFileUrl].filter(Boolean)),
    ) as string[];
    if (files.length) await repository.delete({ course_id: courseId });
    await this.storageCleanupService.enqueueUrls(urls, 'course_deleted', manager);
    await this.storageCleanupService.enqueueCoursePreviewPrefix(courseId, 'course_deleted', manager);
    return urls;
  }

  async clearPageCountCache(fileId: number): Promise<void> {
    await this.courseFileRepository.update(fileId, {
      file_page_count: null,
      file_page_count_key: null,
    });
  }

  async persistPageCount(fileId: number, fileUrl: string, pageCount: number, versionKey: string): Promise<void> {
    const count = Math.max(0, Math.floor(Number(pageCount) || 0));
    if (count <= 0) return;
    const file = await this.courseFileRepository.findOne({
      where: { id: fileId },
    });
    if (!file) return;
    file.file_page_count = count;
    file.file_page_count_key = versionKey;
    await this.courseFileRepository.save(file);
    await this.syncPrimaryMirror(file.course_id);
  }

  getCachedPageCount(
    file: Pick<CourseFile, 'file_url' | 'file_page_count' | 'file_page_count_key'>,
    versionKey: string,
  ): number | null {
    const count = Number(file.file_page_count || 0);
    if (!Number.isInteger(count) || count <= 0) return null;
    const cachedKey = String(file.file_page_count_key || '').trim();
    if (!cachedKey || cachedKey !== versionKey) return null;
    return count;
  }

  formatFileListItem(file: CourseFile) {
    return {
      id: file.id,
      course_id: file.course_id,
      display_name: file.display_name,
      file_url: file.file_url,
      file_name: file.file_name,
      file_type: file.file_type,
      file_size: Number(file.file_size || 0),
      sort: file.sort,
      file_page_count: file.file_page_count,
    };
  }
}
