import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Equal } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Question } from '../../database/entities/question.entity';
import { ExamConfig } from '../../database/entities/exam-config.entity';
import { ExamRecord } from '../../database/entities/exam-record.entity';
import { UserWrongBook } from '../../database/entities/user-wrong-book.entity';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { UserCollection } from '../../database/entities/user-collection.entity';
import { CourseRecommendation } from '../../database/entities/course-recommendation.entity';
import { PreviewCacheTask, PreviewCacheTaskStatus } from '../../database/entities/preview-cache-task.entity';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { UpdateRecommendationsDto } from '../course/dto/update-recommendations.dto';
import { BatchDeleteCoursesDto } from './dto/batch-delete-courses.dto';
import { BatchUpdateStatusDto } from './dto/batch-update-status.dto';
import { BatchAdjustCoursePriceDto } from './dto/batch-adjust-price.dto';
import { SystemService } from '../system/system.service';
import { CourseService } from '../course/course.service';
import { CourseFileService, CourseFileInput } from '../course/course-file.service';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { queryWithRetry } from '../../common/utils/database-retry';
import { assertIntegerYuanPrice, ceilIntegerYuanPrice } from '../../common/utils/price.util';
import {
  buildSimilarCourseGroups,
  collectSimilarCourseIds,
  CourseSimilarityOptions,
  SimilarCourseGroupResult,
} from './course-name-similarity.util';

class PreviewCacheTaskInterruptedError extends Error {
  constructor() {
    super('图片缓存生成任务已中断');
    this.name = 'PreviewCacheTaskInterruptedError';
  }
}

type PreviewCacheFailureDetail = {
  courseId: number;
  courseName: string;
  pageNum: number;
  message: string;
  time: string;
};

@Injectable()
export class AdminCourseService {
  private readonly logger = new Logger(AdminCourseService.name);
  private readonly previewCacheWarmupTimers = new Map<number, { timer: NodeJS.Timeout; force: boolean }>();

  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(ExamConfig)
    private examConfigRepository: Repository<ExamConfig>,
    @InjectRepository(ExamRecord)
    private examRecordRepository: Repository<ExamRecord>,
    @InjectRepository(UserWrongBook)
    private userWrongBookRepository: Repository<UserWrongBook>,
    @InjectRepository(UserAnswerLog)
    private userAnswerLogRepository: Repository<UserAnswerLog>,
    @InjectRepository(UserCollection)
    private userCollectionRepository: Repository<UserCollection>,
    @InjectRepository(CourseRecommendation)
    private courseRecommendationRepository: Repository<CourseRecommendation>,
    @InjectRepository(PreviewCacheTask)
    private previewCacheTaskRepository: Repository<PreviewCacheTask>,
    private systemService: SystemService,
    private courseService: CourseService,
    private courseFileService: CourseFileService,
  ) {}

  /**
   * 新增/编辑课程
   */
  async saveCourse(dto: CreateCourseDto | UpdateCourseDto, id?: number, actorRole?: AdminRole | string) {
    await this.applyDefaultIntroduction(dto, Boolean(id));
    this.validateCoursePriceFields(dto);
    if (id) {
      const course = await this.courseRepository.findOne({ where: { id } });
      if (!course) {
        throw new NotFoundException('课程不存在');
      }
      if (dto.is_free === 0 && dto.validity_days === undefined && course.validity_days == null) {
        dto.validity_days = 365;
      }
      if (dto.is_free === 1) {
        dto.validity_days = null;
      }
      await this.protectCourseFileFromNonAdminDelete(dto, course, actorRole);
      Object.assign(course, dto);
      const saved = await this.courseRepository.save(course);
      await this.ensureCourseFilesFromLegacyFields(saved);
      await this.courseFileService.syncPrimaryMirror(saved.id);
      return saved;
    } else {
      await this.applyCreateCourseDefaults(dto as CreateCourseDto);
      if (dto.sort === undefined || dto.sort === null) {
        dto.sort = await this.getNextSortValue();
      }
      if (dto.is_free === 1) {
        dto.validity_days = null;
      }
      const course = this.courseRepository.create(dto);
      const saved = await this.courseRepository.save(course);
      await this.ensureCourseFilesFromLegacyFields(saved);
      await this.courseFileService.syncPrimaryMirror(saved.id);
      return saved;
    }
  }

  async getCourseDefaultParams() {
    return this.systemService.getCourseDefaultParams();
  }

  async setCourseDefaultParams(input: Record<string, any>) {
    return this.systemService.setCourseDefaultParams(input);
  }

  async getCourseSimilarityConfig() {
    return this.systemService.getCourseSimilarityConfig();
  }

  async setCourseSimilarityConfig(input: Record<string, any>) {
    return this.systemService.setCourseSimilarityConfig(input);
  }

  private async getCourseSimilarityOptions(): Promise<CourseSimilarityOptions> {
    const config = await this.systemService.getCourseSimilarityConfig();
    return { threshold: config.threshold };
  }

  private async applyCreateCourseDefaults(dto: CreateCourseDto) {
    const defaults = await this.systemService.getCourseDefaultParams();
    if (!dto.content_type) {
      dto.content_type = defaults.content_type || 'normal';
    }
    if (dto.subject === undefined || dto.subject === null) {
      dto.subject = defaults.subject || undefined;
    }
    if (dto.school === undefined || dto.school === null) {
      dto.school = defaults.school || undefined;
    }
    if (dto.major === undefined || dto.major === null) {
      dto.major = defaults.major || undefined;
    }
    if (dto.exam_year === undefined || dto.exam_year === null) {
      dto.exam_year = defaults.exam_year || undefined;
    }
    if (dto.answer_year === undefined || dto.answer_year === null) {
      dto.answer_year = defaults.answer_year || undefined;
    }
    if (dto.price === undefined || dto.price === null) {
      dto.price = dto.content_type === 'paper_exam' ? 80 : defaults.price;
    }
    if (dto.agent_price === undefined || dto.agent_price === null) {
      dto.agent_price = defaults.agent_price;
    }
    if (dto.is_free === undefined || dto.is_free === null) {
      dto.is_free = defaults.is_free;
    }
    if (dto.validity_days === undefined) {
      dto.validity_days = defaults.is_free === 1 ? null : defaults.validity_days ?? 365;
    }
    if (dto.allow_source_file === undefined || dto.allow_source_file === null) {
      dto.allow_source_file = defaults.allow_source_file;
    }
    if (dto.status === undefined || dto.status === null) {
      dto.status = defaults.status ?? 0;
    }
  }

  async listCourseFiles(courseId: number) {
    const files = await this.courseFileService.listByCourseId(courseId);
    return files.map((file) => this.courseFileService.formatFileListItem(file));
  }

  async createCourseFile(courseId: number, input: CourseFileInput) {
    const saved = await this.courseFileService.create(courseId, input);
    return this.courseFileService.formatFileListItem(saved);
  }

  async updateCourseFile(
    courseId: number,
    fileId: number,
    patch: Partial<CourseFileInput> & {
      file_url?: string;
      file_name?: string | null;
      file_type?: string;
      file_size?: number;
    },
  ) {
    const before = await this.courseFileService.resolve(courseId, fileId);
    const saved = await this.courseFileService.update(courseId, fileId, patch);
    const fileUrlChanged =
      patch.file_url !== undefined && String(patch.file_url || '').trim() !== String(before.file_url || '').trim();
    const fileTypeChanged =
      patch.file_type !== undefined &&
      String(patch.file_type || '').trim().toLowerCase() !== String(before.file_type || '').trim().toLowerCase();
    if (fileUrlChanged || fileTypeChanged) {
      this.schedulePreviewCacheWarmup(courseId, true);
    }
    return this.courseFileService.formatFileListItem(saved);
  }

  async deleteCourseFile(courseId: number, fileId: number, actorRole?: AdminRole | string) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const files = await this.courseFileService.listByCourseId(courseId);
    if (actorRole !== AdminRole.SUPER_ADMIN && files.length <= 1) {
      throw new BadRequestException('当前账号不能删除课程最后一个文件');
    }
    await this.courseFileService.remove(courseId, fileId);
    await this.courseFileService.syncPrimaryMirror(courseId);
  }

  private async ensureCourseFilesFromLegacyFields(course: Course) {
    if (course.content_type !== 'file') return;
    const files = await this.courseFileService.listByCourseId(course.id);
    if (files.length > 0) return;
    const fileUrl = String(course.file_url || '').trim();
    if (!fileUrl) return;
    await this.courseFileService.create(course.id, {
      display_name: this.courseFileService.stripFileExtension(course.file_name) || course.name || '课程文件',
      file_url: fileUrl,
      file_name: course.file_name,
      file_type: (course.file_type || 'pdf').toLowerCase(),
      file_size: Number(course.file_size || 0),
      sort: 0,
    });
  }

  private async protectCourseFileFromNonAdminDelete(
    dto: CreateCourseDto | UpdateCourseDto,
    course: Course,
    actorRole?: AdminRole | string,
  ) {
    if (actorRole === AdminRole.SUPER_ADMIN) return;
    const hasExistingFile =
      course.content_type === 'file' &&
      ((await this.courseFileService.listByCourseId(course.id)).length > 0 || !!course.file_url);
    if (!hasExistingFile) return;

    const isDeletingFile = dto.content_type !== undefined && dto.content_type !== 'file';
    const isClearingFile = dto.file_url === null || dto.file_url === '';
    if (!isDeletingFile && !isClearingFile) return;

    dto.content_type = 'file';
    const primary = (await this.courseFileService.listByCourseId(course.id))[0];
    dto.file_url = primary?.file_url || course.file_url;
    dto.file_name = primary?.file_name || course.file_name;
    dto.file_type = primary?.file_type || course.file_type;
    dto.file_size = primary?.file_size ?? course.file_size;
  }

  async getPreviewSamplePages(courseId: number, fileId?: number) {
    return this.courseService.getAdminCoursePreviewSamplePages(courseId, fileId);
  }

  async getCourseFilesPdfHealth(courseId: number) {
    const course = await this.courseRepository.findOne({ where: { id: courseId }, select: ['id', 'content_type'] });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (course.content_type !== 'file') {
      return [];
    }
    return this.courseService.getAdminCourseFilesPdfHealth(courseId);
  }

  async checkCourseFilePdfHealthByUrl(fileUrl: string, displayName?: string) {
    if (!fileUrl || typeof fileUrl !== 'string') {
      throw new BadRequestException('fileUrl 不能为空');
    }
    return this.courseService.checkCourseFilePdfHealthByUrl(fileUrl.trim(), displayName?.trim());
  }

  async getPreviewSamplePageImage(courseId: number, pageNum: number, fileId?: number) {
    return this.courseService.getAdminCoursePreviewSamplePageImage(courseId, pageNum, fileId);
  }

  async warmupPreviewCache(courseId: number, force = false) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (!(await this.isPreviewCacheSupportedFileCourse(course))) {
      throw new BadRequestException('仅文件类 PDF/Word 课程支持生成图片缓存');
    }
    return this.courseService.warmupCoursePreviewCacheInBackground(courseId, force);
  }

  /** 课程文件同步完成后统一触发：默认只生成缺失缓存；若期间有换文件则自动 force */
  async warmupPreviewCacheAfterFilesSync(courseId: number, force = false) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (!(await this.isPreviewCacheSupportedFileCourse(course))) {
      return {
        started: false,
        running: false,
        skipped: true,
        message: '非文件类课程或无预览文件，跳过图片缓存生成',
      };
    }

    const pending = this.previewCacheWarmupTimers.get(courseId);
    if (pending) {
      clearTimeout(pending.timer);
      this.previewCacheWarmupTimers.delete(courseId);
      force = pending.force || force;
    }

    return this.courseService.warmupCoursePreviewCacheInBackground(courseId, force);
  }

  async warmupAllMissingPreviewCaches() {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (runningTask) {
      return {
        ...this.formatPreviewCacheTask(runningTask),
        total: runningTask.total_courses,
        started: 0,
        running: 1,
        alreadyRunning: true,
      };
    }

    const courseIds = await this.courseFileService.findCourseIdsWithPreviewableFiles();
    const targets =
      courseIds.length > 0
        ? await this.courseRepository.find({
            where: { id: In(courseIds) },
            select: ['id', 'name', 'content_type', 'file_type', 'file_url'],
            order: { id: 'ASC' },
          })
        : [];
    if (targets.length === 0) {
      return {
        total: 0,
        started: 0,
        running: 0,
        alreadyRunning: false,
        ...this.emptyPreviewCacheProgress(),
      };
    }

    const task = await this.previewCacheTaskRepository.save(
      this.previewCacheTaskRepository.create({
        task_no: this.createPreviewCacheTaskNo(),
        trigger_type: 'manual',
        status: PreviewCacheTaskStatus.PENDING,
        total_courses: targets.length,
        message: '任务已创建，等待开始生成',
      }),
    );

    void this.runPreviewCacheTask(task.id, targets, false);

    return {
      total: targets.length,
      started: targets.length,
      running: 0,
      alreadyRunning: false,
      ...this.formatPreviewCacheTask(task),
    };
  }

  async getPreviewCacheProgress() {
    const records = await this.previewCacheTaskRepository.find({
      order: { id: 'DESC' },
      take: 10,
    });
    const runningTask = await this.findRunningPreviewCacheTask();
    const latest = runningTask
      ? runningTask
      : await this.previewCacheTaskRepository.findOne({
          where: {},
          order: { id: 'DESC' },
        });
    return this.formatPreviewCacheTask(latest, records);
  }

  async interruptPreviewCacheTask() {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (!runningTask) {
      const latest = await this.previewCacheTaskRepository.findOne({
        where: {},
        order: { id: 'DESC' },
      });
      return {
        interrupted: false,
        message: '当前没有正在生成的图片缓存任务',
        ...this.formatPreviewCacheTask(latest),
      };
    }

    await this.previewCacheTaskRepository.update(runningTask.id, {
      status: PreviewCacheTaskStatus.INTERRUPTED,
      current_course_id: null,
      current_course_name: null,
      current_page: 0,
      message: '任务已手动中断',
      finished_at: new Date(),
    });

    const task = await this.previewCacheTaskRepository.findOne({ where: { id: runningTask.id } });
    return {
      interrupted: true,
      message: '已中断图片缓存生成任务',
      ...this.formatPreviewCacheTask(task),
    };
  }

  async warmupFailedPreviewCaches(taskId?: number) {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (runningTask) {
      return {
        ...this.formatPreviewCacheTask(runningTask),
        total: runningTask.total_courses,
        started: 0,
        running: 1,
        alreadyRunning: true,
      };
    }

    const failedTask = taskId
      ? await this.previewCacheTaskRepository.findOne({ where: { id: taskId } })
      : await this.previewCacheTaskRepository.findOne({
          where: { status: PreviewCacheTaskStatus.FAILED },
          order: { id: 'DESC' },
        });

    if (!failedTask) {
      throw new BadRequestException('暂无失败的图片缓存生成任务');
    }

    const failedDetails = this.parsePreviewCacheFailedDetails(failedTask.failed_details);
    const courseIds = Array.from(new Set(failedDetails.map((item) => item.courseId).filter((id) => id > 0)));
    if (courseIds.length === 0) {
      throw new BadRequestException('失败任务没有可重试的课程明细，请重新生成全部缺失缓存');
    }

    const courses = await this.courseRepository.find({
      where: { id: In(courseIds) },
      select: ['id', 'name', 'content_type', 'file_type', 'file_url'],
      order: { id: 'ASC' },
    });
    const targets: Course[] = [];
    for (const course of courses) {
      if (
        course.content_type === 'file' &&
        (await this.isPreviewCacheSupportedFileCourse(course))
      ) {
        targets.push(course);
      }
    }
    if (targets.length === 0) {
      throw new BadRequestException('失败明细中的课程已不存在或不是文件类 PDF/Word 课程');
    }

    const task = await this.previewCacheTaskRepository.save(
      this.previewCacheTaskRepository.create({
        task_no: this.createPreviewCacheTaskNo(),
        trigger_type: 'retry',
        status: PreviewCacheTaskStatus.PENDING,
        total_courses: targets.length,
        message: `任务已创建，准备重新生成 ${targets.length} 个失败课程的图片缓存`,
        failed_details: JSON.stringify([]),
      }),
    );

    void this.runPreviewCacheTask(task.id, targets, false);

    return {
      total: targets.length,
      started: targets.length,
      running: 0,
      alreadyRunning: false,
      retryFromTaskNo: failedTask.task_no,
      ...this.formatPreviewCacheTask(task),
    };
  }

  async listPreviewCacheTargets(keyword?: string) {
    const courseIds = await this.courseFileService.findCourseIdsWithPreviewableFiles();
    if (courseIds.length === 0) {
      return { list: [], total: 0 };
    }

    const queryBuilder = this.courseRepository
      .createQueryBuilder('course')
      .select([
        'course.id',
        'course.name',
        'course.subject',
        'course.category',
        'course.sub_category',
        'course.content_type',
      ])
      .where('course.id IN (:...courseIds)', { courseIds })
      .orderBy('course.id', 'ASC');

    const trimmedKeyword = String(keyword || '').trim();
    if (trimmedKeyword) {
      queryBuilder.andWhere('course.name LIKE :keyword', { keyword: `%${trimmedKeyword}%` });
    }

    const list = await queryBuilder.getMany();
    return {
      list: list.map((course) => ({
        id: course.id,
        name: course.name,
        subject: course.subject,
        category: course.category,
        subCategory: course.sub_category,
        contentType: course.content_type,
      })),
      total: list.length,
    };
  }

  async warmupSelectedPreviewCaches(courseIds: number[]) {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (runningTask) {
      return {
        ...this.formatPreviewCacheTask(runningTask),
        total: runningTask.total_courses,
        started: 0,
        running: 1,
        alreadyRunning: true,
      };
    }

    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      throw new BadRequestException('请至少选择一个课程');
    }

    const uniqueIds = Array.from(
      new Set(courseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (uniqueIds.length === 0) {
      throw new BadRequestException('courseIds 必须是大于 0 的整数数组');
    }

    const courses = await this.courseRepository.find({
      where: { id: In(uniqueIds) },
      select: ['id', 'name', 'content_type', 'file_type', 'file_url'],
      order: { id: 'ASC' },
    });
    const targets: Course[] = [];
    for (const course of courses) {
      if (await this.isPreviewCacheSupportedFileCourse(course)) {
        targets.push(course);
      }
    }
    if (targets.length === 0) {
      throw new BadRequestException('所选课程均不支持图片缓存（需为文件类 PDF/Word 课程）');
    }

    const task = await this.previewCacheTaskRepository.save(
      this.previewCacheTaskRepository.create({
        task_no: this.createPreviewCacheTaskNo(),
        trigger_type: 'force-selected',
        status: PreviewCacheTaskStatus.PENDING,
        total_courses: targets.length,
        message: `任务已创建，准备强制重新生成 ${targets.length} 个课程的图片缓存`,
        failed_details: JSON.stringify([]),
      }),
    );

    void this.runPreviewCacheTask(task.id, targets, true);

    return {
      total: targets.length,
      started: targets.length,
      running: 0,
      alreadyRunning: false,
      selectedCourseIds: targets.map((course) => course.id),
      ...this.formatPreviewCacheTask(task),
    };
  }

  async fixBlankPreviewCaches(triggerType = 'fix-blank') {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (runningTask) {
      return {
        ...this.formatPreviewCacheTask(runningTask),
        total: runningTask.total_courses,
        started: 0,
        running: 1,
        alreadyRunning: true,
        detected: [],
      };
    }

    const task = await this.previewCacheTaskRepository.save(
      this.previewCacheTaskRepository.create({
        task_no: this.createPreviewCacheTaskNo(),
        trigger_type: triggerType,
        status: PreviewCacheTaskStatus.PENDING,
        total_courses: 0,
        message: '正在检测空白预览图课程，请稍候…',
        failed_details: JSON.stringify([]),
      }),
    );

    void this.runFixBlankPreviewCacheTask(task.id);

    return {
      total: 0,
      started: 1,
      running: 0,
      alreadyRunning: false,
      detected: [],
      ...this.formatPreviewCacheTask(task),
    };
  }

  /**
   * 定时巡检：检测空白/缺失/不完整预览缓存，并自动触发修复任务。
   * 可被 @Cron 或独立脚本调用。
   */
  async runScheduledPreviewCacheMaintenance() {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (runningTask) {
      this.logger.log(`预览缓存定时巡检跳过：已有任务运行中 taskId=${runningTask.id}`);
      return {
        action: 'skipped',
        reason: 'task_running',
        taskId: runningTask.id,
      };
    }

    const cooldownHours = Number(process.env.PREVIEW_CACHE_MAINTENANCE_COOLDOWN_HOURS || 2);
    const cooldownMs = Math.max(0, cooldownHours) * 60 * 60 * 1000;
    if (cooldownMs > 0) {
      const recentScheduled = await this.previewCacheTaskRepository.findOne({
        where: {
          trigger_type: 'scheduled',
          status: PreviewCacheTaskStatus.COMPLETED,
        },
        order: { finished_at: 'DESC' },
      });
      if (recentScheduled?.finished_at) {
        const elapsed = Date.now() - new Date(recentScheduled.finished_at).getTime();
        const message = recentScheduled.message || '';
        if (elapsed < cooldownMs && (message.includes('无需修复') || message.includes('未检测到'))) {
          this.logger.log('预览缓存定时巡检跳过：最近已完成且无异常');
          return {
            action: 'skipped',
            reason: 'recently_checked_ok',
            taskId: recentScheduled.id,
          };
        }
      }
    }

    const healthIssues = await this.courseService.scanPreviewCacheHealth();
    this.logger.log(`预览缓存定时巡检：发现 ${healthIssues.length} 个问题`);

    if (healthIssues.length > 0) {
      const blankCourseIds = Array.from(
        new Set(healthIssues.filter((item) => item.issue === 'blank').map((item) => item.courseId)),
      );
      if (blankCourseIds.length > 0) {
        const result = await this.fixBlankPreviewCaches('scheduled');
        return {
          action: 'fix_blank',
          issueCount: healthIssues.length,
          courseIds: blankCourseIds,
          ...result,
        };
      }

      const repairCourseIds = Array.from(new Set(healthIssues.map((item) => item.courseId)));
      const result = await this.startPreviewCacheTaskForCourses(
        repairCourseIds,
        false,
        'scheduled',
        `定时巡检发现 ${repairCourseIds.length} 个课程预览缓存不完整，开始补全缺失页`,
      );
      return {
        action: 'repair_incomplete',
        issueCount: healthIssues.length,
        courseIds: repairCourseIds,
        issues: healthIssues,
        ...result,
      };
    }

    const failedTask = await this.previewCacheTaskRepository.findOne({
      where: { status: PreviewCacheTaskStatus.FAILED },
      order: { finished_at: 'DESC' },
    });
    if (failedTask?.finished_at) {
      const ageMs = Date.now() - new Date(failedTask.finished_at).getTime();
      const minAgeMs = 60 * 60 * 1000;
      const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
      if (ageMs >= minAgeMs && ageMs <= maxAgeMs) {
        try {
          const result = await this.warmupFailedPreviewCaches(failedTask.id);
          this.logger.log(`预览缓存定时巡检：重试失败任务 taskId=${failedTask.id}`);
          return {
            action: 'retry_failed',
            failedTaskId: failedTask.id,
            ...result,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`预览缓存定时巡检：重试失败任务跳过 ${message}`);
        }
      }
    }

    const noopTask = await this.previewCacheTaskRepository.save(
      this.previewCacheTaskRepository.create({
        task_no: this.createPreviewCacheTaskNo(),
        trigger_type: 'scheduled',
        status: PreviewCacheTaskStatus.COMPLETED,
        message: '定时巡检完成，无需修复',
        finished_at: new Date(),
      }),
    );
    return {
      action: 'none',
      message: '定时巡检完成，无需修复',
      taskId: noopTask.id,
    };
  }

  async getPreviewCacheHealthReport() {
    const issues = await this.courseService.scanPreviewCacheHealth();
    const runningTask = await this.findRunningPreviewCacheTask();
    return {
      issueCount: issues.length,
      issues,
      runningTask: runningTask ? this.formatPreviewCacheTask(runningTask) : null,
    };
  }

  private async startPreviewCacheTaskForCourses(
    courseIds: number[],
    force: boolean,
    triggerType: string,
    message: string,
  ) {
    const runningTask = await this.findRunningPreviewCacheTask();
    if (runningTask) {
      return {
        ...this.formatPreviewCacheTask(runningTask),
        total: runningTask.total_courses,
        started: 0,
        running: 1,
        alreadyRunning: true,
      };
    }

    const uniqueIds = Array.from(
      new Set(courseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (uniqueIds.length === 0) {
      throw new BadRequestException('没有可修复的课程');
    }

    const courses = await this.courseRepository.find({
      where: { id: In(uniqueIds) },
      select: ['id', 'name', 'content_type', 'file_type', 'file_url'],
      order: { id: 'ASC' },
    });
    const targets: Course[] = [];
    for (const course of courses) {
      if (await this.isPreviewCacheSupportedFileCourse(course)) {
        targets.push(course);
      }
    }
    if (targets.length === 0) {
      throw new BadRequestException('目标课程均不支持图片缓存');
    }

    const task = await this.previewCacheTaskRepository.save(
      this.previewCacheTaskRepository.create({
        task_no: this.createPreviewCacheTaskNo(),
        trigger_type: triggerType,
        status: PreviewCacheTaskStatus.PENDING,
        total_courses: targets.length,
        message,
        failed_details: JSON.stringify([]),
      }),
    );

    void this.runPreviewCacheTask(task.id, targets, force);

    return {
      total: targets.length,
      started: targets.length,
      running: 0,
      alreadyRunning: false,
      selectedCourseIds: targets.map((course) => course.id),
      ...this.formatPreviewCacheTask(task),
    };
  }

  private async runFixBlankPreviewCacheTask(taskId: number) {
    try {
      const detected = await this.courseService.scanCoursesWithBlankPreviewCache();
      if (detected.length === 0) {
        await this.previewCacheTaskRepository.update(taskId, {
          status: PreviewCacheTaskStatus.COMPLETED,
          message: '未检测到空白预览图课程',
          finished_at: new Date(),
        });
        return;
      }

      const courseIds = Array.from(new Set(detected.map((item) => item.courseId)));
      const targets = await this.courseRepository.find({
        where: { id: In(courseIds) },
        select: ['id', 'name', 'content_type', 'file_type', 'file_url'],
        order: { id: 'ASC' },
      });
      const validTargets: Course[] = [];
      for (const course of targets) {
        if (await this.isPreviewCacheSupportedFileCourse(course)) {
          validTargets.push(course);
        }
      }
      if (validTargets.length === 0) {
        await this.previewCacheTaskRepository.update(taskId, {
          status: PreviewCacheTaskStatus.COMPLETED,
          message: '检测到空白预览图，但对应课程已不可用',
          finished_at: new Date(),
        });
        return;
      }

      await this.previewCacheTaskRepository.update(taskId, {
        total_courses: validTargets.length,
        message: `已检测到 ${validTargets.length} 个空白预览图课程，开始强制重新生成`,
      });

      await this.runPreviewCacheTask(taskId, validTargets, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.previewCacheTaskRepository.update(taskId, {
        status: PreviewCacheTaskStatus.FAILED,
        message: `空白图修复失败：${message}`,
        finished_at: new Date(),
      });
    }
  }

  private async findRunningPreviewCacheTask() {
    const runningTask = await this.previewCacheTaskRepository.findOne({
      where: {
        status: In([PreviewCacheTaskStatus.PENDING, PreviewCacheTaskStatus.RUNNING]),
      },
      order: { update_time: 'DESC' },
    });
    if (!runningTask) return null;

    const updatedAt = runningTask.update_time ? new Date(runningTask.update_time).getTime() : 0;
    const staleMs = 60 * 60 * 1000;
    if (updatedAt > 0 && Date.now() - updatedAt > staleMs) {
      await this.previewCacheTaskRepository.update(runningTask.id, {
        status: PreviewCacheTaskStatus.FAILED,
        message: '任务长时间无进度，已自动标记为失败，可重新生成',
        finished_at: new Date(),
      });
      return null;
    }
    return runningTask;
  }

  private async runPreviewCacheTask(taskId: number, courses: Course[], force: boolean) {
    const totals = {
      totalPages: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
    };
    const failedDetails: PreviewCacheFailureDetail[] = [];
    let processedCourses = 0;

    await this.previewCacheTaskRepository.update(taskId, {
      status: PreviewCacheTaskStatus.RUNNING,
      started_at: new Date(),
      message: '正在生成图片缓存',
      failed_details: JSON.stringify(failedDetails),
    });

    for (const course of courses) {
      if (await this.isPreviewCacheTaskInterrupted(taskId)) {
        await this.markPreviewCacheTaskInterrupted(taskId);
        return;
      }

      await this.previewCacheTaskRepository.update(taskId, {
        status: PreviewCacheTaskStatus.RUNNING,
        current_course_id: course.id,
        current_course_name: course.name,
        current_page: 0,
        message: `正在生成：${course.name}`,
      });

      let interrupted = false;
      try {
        const result = await this.courseService.generateCoursePreviewCache(course.id, force, async (progress) => {
          if (await this.isPreviewCacheTaskInterrupted(taskId)) {
            throw new PreviewCacheTaskInterruptedError();
          }
          const processedPages = (progress.generated || 0) + (progress.skipped || 0) + (progress.failed || 0);
          const pageTotal = totals.totalPages + (progress.totalPages || 0);
          const pageProcessed = Math.min(pageTotal, totals.generated + totals.skipped + totals.failed + processedPages);
          await this.previewCacheTaskRepository.update(taskId, {
            status: PreviewCacheTaskStatus.RUNNING,
            current_course_id: course.id,
            current_course_name: course.name,
            current_page: progress.currentPage || 0,
            total_pages: pageTotal,
            processed_pages: pageProcessed,
            generated_pages: totals.generated + (progress.generated || 0),
            skipped_pages: totals.skipped + (progress.skipped || 0),
            failed_pages: totals.failed + (progress.failed || 0),
            message: progress.message || `正在生成：${course.name}`,
            failed_details: JSON.stringify(failedDetails),
          });
        });

        totals.totalPages += result.totalPages || 0;
        totals.generated += result.generated || 0;
        totals.skipped += result.skipped || 0;
        totals.failed += result.failed || 0;
        if (Array.isArray(result.errors) && result.errors.length > 0) {
          result.errors.forEach((item) => {
            failedDetails.push({
              courseId: course.id,
              courseName: course.name,
              pageNum: item.pageNum,
              message: item.message,
              time: new Date().toISOString(),
            });
          });
          await this.previewCacheTaskRepository.update(taskId, {
            failed_details: JSON.stringify(failedDetails),
          });
        }
      } catch (error) {
        if (error instanceof PreviewCacheTaskInterruptedError) {
          interrupted = true;
          await this.markPreviewCacheTaskInterrupted(taskId);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        totals.failed += 1;
        failedDetails.push({
          courseId: course.id,
          courseName: course.name,
          pageNum: 0,
          message,
          time: new Date().toISOString(),
        });
        await this.previewCacheTaskRepository.update(taskId, {
          failed_pages: totals.failed,
          message: `课程 ${course.name} 生成失败：${message}`,
          failed_details: JSON.stringify(failedDetails),
        });
      } finally {
        if (interrupted) {
          return;
        }
        processedCourses += 1;
        await this.previewCacheTaskRepository.update(taskId, {
          processed_courses: processedCourses,
          total_pages: totals.totalPages,
          processed_pages: totals.generated + totals.skipped + totals.failed,
          generated_pages: totals.generated,
          skipped_pages: totals.skipped,
          failed_pages: totals.failed,
          failed_details: JSON.stringify(failedDetails),
        });
      }
    }

    await this.previewCacheTaskRepository.update(taskId, {
      status: totals.failed > 0 ? PreviewCacheTaskStatus.FAILED : PreviewCacheTaskStatus.COMPLETED,
      current_course_id: null,
      current_course_name: null,
      current_page: 0,
      message: totals.failed > 0 ? '图片缓存生成完成，但存在失败页面' : '图片缓存生成完成',
      finished_at: new Date(),
      failed_details: JSON.stringify(failedDetails),
    });
  }

  private async isPreviewCacheTaskInterrupted(taskId: number) {
    const task = await this.previewCacheTaskRepository.findOne({
      where: { id: taskId },
      select: ['id', 'status'],
    });
    return task?.status === PreviewCacheTaskStatus.INTERRUPTED;
  }

  private async markPreviewCacheTaskInterrupted(taskId: number) {
    await this.previewCacheTaskRepository.update(taskId, {
      status: PreviewCacheTaskStatus.INTERRUPTED,
      current_course_id: null,
      current_course_name: null,
      current_page: 0,
      message: '任务已手动中断',
      finished_at: new Date(),
    });
  }

  private createPreviewCacheTaskNo() {
    return `PCT${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  private formatPreviewCacheTask(task: PreviewCacheTask | null, records: PreviewCacheTask[] = []) {
    if (!task) {
      return {
        ...this.emptyPreviewCacheProgress(),
        records: records.map((item) => this.formatPreviewCacheRecord(item)),
      };
    }
    const running = [PreviewCacheTaskStatus.PENDING, PreviewCacheTaskStatus.RUNNING].includes(task.status);
    return {
      taskId: task.id,
      taskNo: task.task_no,
      status: task.status,
      message: task.message,
      totalCourses: task.total_courses || 0,
      processedCourses: task.processed_courses || 0,
      runningCourses: running ? 1 : 0,
      completedCourses: task.status === PreviewCacheTaskStatus.COMPLETED ? 1 : 0,
      failedCourses: task.status === PreviewCacheTaskStatus.FAILED ? 1 : 0,
      currentCourseId: task.current_course_id,
      currentCourseName: task.current_course_name,
      currentPage: task.current_page || 0,
      totalPages: task.total_pages || 0,
      processed: task.processed_pages || 0,
      generated: task.generated_pages || 0,
      skipped: task.skipped_pages || 0,
      failed: task.failed_pages || 0,
      failedDetails: this.parsePreviewCacheFailedDetails(task.failed_details),
      startedAt: task.started_at,
      finishedAt: task.finished_at,
      updatedAt: task.update_time,
      courses: [],
      records: (records.length ? records : [task]).map((item) => this.formatPreviewCacheRecord(item)),
    };
  }

  private formatPreviewCacheRecord(task: PreviewCacheTask) {
    return {
      id: task.id,
      taskNo: task.task_no,
      status: task.status,
      totalCourses: task.total_courses || 0,
      processedCourses: task.processed_courses || 0,
      totalPages: task.total_pages || 0,
      processed: task.processed_pages || 0,
      generated: task.generated_pages || 0,
      skipped: task.skipped_pages || 0,
      failed: task.failed_pages || 0,
      message: task.message,
      failedDetails: this.parsePreviewCacheFailedDetails(task.failed_details),
      createTime: task.create_time,
      updateTime: task.update_time,
      finishedAt: task.finished_at,
    };
  }

  private emptyPreviewCacheProgress() {
    return {
      taskId: null,
      taskNo: '',
      status: 'idle',
      message: '',
      totalCourses: 0,
      processedCourses: 0,
      runningCourses: 0,
      completedCourses: 0,
      failedCourses: 0,
      currentCourseId: null,
      currentCourseName: '',
      currentPage: 0,
      totalPages: 0,
      processed: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      failedDetails: [],
      courses: [],
      records: [],
    };
  }

  private parsePreviewCacheFailedDetails(raw?: string | null): PreviewCacheFailureDetail[] {
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list
        .map((item) => ({
          courseId: Number(item?.courseId) || 0,
          courseName: String(item?.courseName || ''),
          pageNum: Number(item?.pageNum) || 0,
          message: String(item?.message || ''),
          time: String(item?.time || ''),
        }))
        .filter((item) => item.courseId > 0 && item.message);
    } catch (_) {
      return [];
    }
  }

  private schedulePreviewCacheWarmup(courseId: number, force = false) {
    const existing = this.previewCacheWarmupTimers.get(courseId);
    if (existing) {
      clearTimeout(existing.timer);
      force = existing.force || force;
    }
    const timer = setTimeout(() => {
      this.previewCacheWarmupTimers.delete(courseId);
      void this.warmupPreviewCacheIfNeededById(courseId, force);
    }, 800);
    this.previewCacheWarmupTimers.set(courseId, { timer, force });
  }

  private async warmupPreviewCacheIfNeededById(courseId: number, force = false) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) return;
    await this.warmupPreviewCacheIfNeeded(course, force);
  }

  private async warmupPreviewCacheIfNeeded(course: Course, force = false) {
    if (!(await this.isPreviewCacheSupportedFileCourse(course))) {
      return;
    }
    this.courseService.warmupCoursePreviewCacheInBackground(course.id, force);
  }

  private async isPreviewCacheSupportedFileCourse(course: Pick<Course, 'id' | 'content_type'>) {
    if (course.content_type !== 'file') return false;
    const files = await this.courseFileService.listByCourseId(course.id);
    return files.some((file) => ['pdf', 'doc', 'docx'].includes((file.file_type || '').toLowerCase()));
  }

  private async applyDefaultIntroduction(dto: CreateCourseDto | UpdateCourseDto, isUpdate: boolean) {
    const hasIntroductionField = Object.prototype.hasOwnProperty.call(dto, 'introduction');
    if (isUpdate && !hasIntroductionField) {
      return;
    }
    if (!this.isBlankRichText(dto.introduction)) {
      return;
    }
    const template = await this.systemService.getCourseIntroTemplate();
    dto.introduction = template || '';
  }

  private isBlankRichText(value?: string | null) {
    const text = String(value || '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#160;/g, ' ')
      .replace(/\s+/g, '')
      .trim();
    return text.length === 0;
  }

  /**
   * 下拉选项：仅返回必要字段，避免拉取 introduction 等大字段
   */
  async getCourseOptions(filters?: { name?: string; status?: number }) {
    const queryBuilder = this.courseRepository
      .createQueryBuilder('course')
      .select([
        'course.id',
        'course.name',
        'course.status',
        'course.category',
        'course.sub_category',
        'course.price',
        'course.is_free',
      ]);

    if (filters?.name?.trim()) {
      queryBuilder.andWhere('course.name LIKE :name', { name: `%${filters.name.trim()}%` });
    }
    if (filters?.status !== undefined && filters?.status !== null && !Number.isNaN(filters.status)) {
      queryBuilder.andWhere('course.status = :status', { status: filters.status });
    }

    return queryWithRetry(
      () =>
        queryBuilder
          .orderBy('course.sort', 'ASC')
          .addOrderBy('course.id', 'ASC')
          .getMany(),
      { action: '获取课程选项', logger: this.logger },
    );
  }

  /**
   * 检测同名或名称相近的课程分组
   */
  async getSimilarCourseGroups(filters?: {
    name?: string;
    subject?: string;
    category?: string;
    subCategory?: string;
    status?: number;
  }) {
    const similarityOptions = await this.getCourseSimilarityOptions();
    const courses = await this.getCourseList({
      name: filters?.name,
      subject: filters?.subject,
      category: filters?.category,
      subCategory: filters?.subCategory,
      status: filters?.status,
    });
    const groups = buildSimilarCourseGroups(
      courses.map((course) => ({ id: course.id, name: course.name })),
      similarityOptions,
    );
    const courseMap = new Map(courses.map((course) => [course.id, course]));

    return {
      similarityThreshold: similarityOptions.threshold,
      groupCount: groups.length,
      duplicateCourseCount: collectSimilarCourseIds(groups).length,
      groups: groups.map((group) => ({
        ...group,
        courses: group.courseIds
          .map((id) => courseMap.get(id))
          .filter((course): course is Course => Boolean(course)),
      })),
    };
  }

  private buildSimilarCourseMeta(groups: SimilarCourseGroupResult[]) {
    const meta = new Map<number, { similar_group_id: string; similar_match_type: string }>();
    groups.forEach((group) => {
      group.courseIds.forEach((id) => {
        meta.set(id, {
          similar_group_id: group.groupId,
          similar_match_type: group.matchType,
        });
      });
    });
    return meta;
  }

  /**
   * 获取课程列表
   */
  async getCourseList(filters?: {
    name?: string;
    subject?: string;
    category?: string;
    subCategory?: string;
    status?: number;
    similarOnly?: boolean;
  }) {
    const queryBuilder = this.courseRepository.createQueryBuilder('course').select([
      'course.id',
      'course.name',
      'course.subject',
      'course.category',
      'course.sub_category',
      'course.school',
      'course.major',
      'course.exam_year',
      'course.answer_year',
      'course.cover_img',
      'course.price',
      'course.agent_price',
      'course.is_free',
      'course.validity_days',
      'course.student_count',
      'course.sort',
      'course.status',
      'course.content_type',
      'course.file_name',
      'course.file_type',
      'course.file_size',
      'course.file_page_count',
      'course.allow_source_file',
      'course.recommended_course_ids',
      'course.create_time',
      'course.update_time',
    ]);

    if (filters?.name?.trim()) {
      queryBuilder.andWhere('course.name LIKE :name', { name: `%${filters.name.trim()}%` });
    }
    if (filters?.subject?.trim()) {
      queryBuilder.andWhere('course.subject LIKE :subject', { subject: `%${filters.subject.trim()}%` });
    }
    if (filters?.category?.trim()) {
      queryBuilder.andWhere('course.category = :category', { category: filters.category.trim() });
    }
    if (filters?.subCategory?.trim()) {
      queryBuilder.andWhere('course.sub_category = :subCategory', { subCategory: filters.subCategory.trim() });
    }
    if (filters?.status !== undefined && filters.status !== null && !Number.isNaN(filters.status)) {
      queryBuilder.andWhere('course.status = :status', { status: filters.status });
    }

    let similarMeta = new Map<number, { similar_group_id: string; similar_match_type: string }>();
    if (filters?.similarOnly) {
      const similarityOptions = await this.getCourseSimilarityOptions();
      const baseCourses = await queryWithRetry(
        () =>
          queryBuilder
            .clone()
            .orderBy('course.sort', 'ASC')
            .addOrderBy('course.id', 'ASC')
            .getMany(),
        { action: '获取课程列表（相似检测）', logger: this.logger },
      );
      const groups = buildSimilarCourseGroups(
        baseCourses.map((course) => ({ id: course.id, name: course.name })),
        similarityOptions,
      );
      const similarIds = collectSimilarCourseIds(groups);
      if (similarIds.length === 0) {
        return [];
      }
      similarMeta = this.buildSimilarCourseMeta(groups);
      queryBuilder.andWhere('course.id IN (:...similarIds)', { similarIds });
    }

    const list = await queryWithRetry(
      () =>
        queryBuilder
          .orderBy('course.sort', 'ASC')
          .addOrderBy('course.id', 'ASC')
          .getMany(),
      { action: '获取课程列表', logger: this.logger },
    );

    if (!filters?.similarOnly || similarMeta.size === 0) {
      return list;
    }

    return list.map((course) => {
      const extra = similarMeta.get(course.id);
      return extra ? { ...course, ...extra } : course;
    });
  }

  /**
   * 获取课程详情
   */
  async getCourseDetail(id: number) {
    const course = await this.courseRepository.findOne({
      where: { id },
      relations: ['chapters'],
    });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const files =
      course.content_type === 'file' ? await this.listCourseFiles(id) : [];
    return { ...course, files };
  }

  /**
   * 删除课程（级联删除关联数据）
   */
  async deleteCourse(id: number) {
    const course = await this.courseRepository.findOne({ where: { id } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }

    // 1. 查找该课程下的所有章节
    const chapters = await this.chapterRepository.find({
      where: { course_id: id },
    });
    const chapterIds = chapters.map((ch) => ch.id);

    // 2. 查找该课程下所有章节的题目
    const questions = chapterIds.length > 0
      ? await this.questionRepository.find({
          where: { chapter_id: In(chapterIds) },
        })
      : [];
    const questionIds = questions.map((q) => q.id);

    // 3. 删除用户收藏（基于题目ID）
    if (questionIds.length > 0) {
      await this.userCollectionRepository.delete({
        question_id: In(questionIds),
      });
    }

    // 4. 删除用户错题本（基于课程ID）
    await this.userWrongBookRepository.delete({
      course_id: id,
    });

    // 5. 删除用户答题记录（基于章节ID）
    if (chapterIds.length > 0) {
      await this.userAnswerLogRepository.delete({
        chapter_id: In(chapterIds),
      });
    }

    // 6. 删除题目
    if (questionIds.length > 0) {
      await this.questionRepository.delete({
        chapter_id: In(chapterIds),
      });
    }

    // 7. 删除章节
    if (chapterIds.length > 0) {
      await this.chapterRepository.delete({
        course_id: id,
      });
    }

    // 8. 删除该课程的考试记录
    const examConfigs = await this.examConfigRepository.find({
      where: { course_id: id },
    });
    const examConfigIds = examConfigs.map((config) => config.id);
    if (examConfigIds.length > 0) {
      await this.examRecordRepository.delete({
        exam_config_id: In(examConfigIds),
      });
    }

    // 9. 删除该课程的考试配置
    await this.examConfigRepository.delete({
      course_id: id,
    });

    // 10. 最后删除课程
    await this.courseRepository.remove(course);
    return { success: true };
  }

  /**
   * 获取相关推荐配置
   * @param courseId 课程ID，不传或传null表示获取公共配置
   */
  async getRecommendations(courseId?: number | null) {
    // 如果 courseId 存在，从 course 表读取；如果为 null，从 course_recommendation 表读取公共配置
    
    if (courseId !== undefined && courseId !== null) {
      // 验证 courseId
      const numValue = typeof courseId === 'number' ? courseId : Number(courseId);
      if (!Number.isFinite(numValue) || isNaN(numValue) || numValue <= 0) {
        throw new Error(`无效的 courseId: ${courseId}`);
      }
      
      // 从 course 表读取课程推荐配置
      const course = await this.courseRepository.findOne({
        where: { id: numValue },
        select: ['id', 'recommended_course_ids'],
      });
      
      if (!course) {
        throw new NotFoundException('课程不存在');
      }
      
      return {
        courseId: numValue,
        recommendedCourseIds: course.recommended_course_ids || [],
      };
    } else {
      // 从 course_recommendation 表读取公共配置
      // course_recommendation 表现在只存储公共配置（只有一条记录）
      // 使用 find 方法获取第一条记录，因为 findOne 需要 where 条件
      const recommendations = await this.courseRecommendationRepository.find({
        order: { id: 'ASC' },
        take: 1, // 只取第一条记录
      });
      
      const recommendation = recommendations.length > 0 ? recommendations[0] : null;
      
      return {
        courseId: null,
        recommendedCourseIds: recommendation?.recommended_course_ids || [],
      };
    }
  }

  /**
   * 更新相关推荐配置
   * 如果 courseId 存在，更新 course 表；如果为 null，更新 course_recommendation 表的公共配置
   */
  async updateRecommendations(dto: UpdateRecommendationsDto) {
    if (dto.courseId !== undefined && dto.courseId !== null) {
      // 更新课程级别的配置（存储在 course 表中）
      const numValue = typeof dto.courseId === 'number' ? dto.courseId : Number(dto.courseId);
      if (!Number.isFinite(numValue) || isNaN(numValue) || numValue <= 0) {
        throw new Error(`无效的 courseId: ${dto.courseId}`);
      }
      
      const course = await this.courseRepository.findOne({
        where: { id: numValue },
      });
      
      if (!course) {
        throw new NotFoundException('课程不存在');
      }
      
      course.recommended_course_ids = dto.recommendedCourseIds;
      await this.courseRepository.save(course);
      
      return {
        courseId: numValue,
        recommendedCourseIds: dto.recommendedCourseIds,
      };
    } else {
      // 更新公共配置（存储在 course_recommendation 表中）
      // course_recommendation 表现在只存储公共配置（只有一条记录）
      // 使用 find 方法获取第一条记录，因为 findOne 需要 where 条件
      const recommendations = await this.courseRecommendationRepository.find({
        order: { id: 'ASC' },
        take: 1, // 只取第一条记录
      });
      
      let recommendation = recommendations.length > 0 ? recommendations[0] : null;
      
      if (recommendation) {
        // 更新现有公共配置
        recommendation.recommended_course_ids = dto.recommendedCourseIds;
        await this.courseRecommendationRepository.save(recommendation);
      } else {
        // 创建新的公共配置（如果不存在）
        recommendation = this.courseRecommendationRepository.create({
          recommended_course_ids: dto.recommendedCourseIds,
        });
        await this.courseRecommendationRepository.save(recommendation);
      }
      
      return {
        courseId: null,
        recommendedCourseIds: dto.recommendedCourseIds,
      };
    }
  }

  /**
   * 批量删除课程
   */
  async batchDeleteCourses(dto: BatchDeleteCoursesDto) {
    if (!dto.ids || dto.ids.length === 0) {
      throw new Error('课程ID列表不能为空');
    }

    const courses = await this.courseRepository.find({
      where: { id: In(dto.ids) },
    });

    if (courses.length === 0) {
      throw new NotFoundException('未找到要删除的课程');
    }

    // 批量删除每个课程的关联数据
    for (const course of courses) {
      await this.deleteCourse(course.id);
    }

    return {
      success: true,
      count: courses.length,
    };
  }

  /**
   * 批量更新课程状态
   */
	  async batchUpdateStatus(dto: BatchUpdateStatusDto) {
    if (!dto.ids || dto.ids.length === 0) {
      throw new Error('课程ID列表不能为空');
    }

    const courses = await this.courseRepository.find({
      where: { id: In(dto.ids) },
    });

    if (courses.length === 0) {
      throw new NotFoundException('未找到要更新的课程');
    }

    // 批量更新状态
    await this.courseRepository.update(
      { id: In(dto.ids) },
      { status: dto.status },
    );

    return {
      success: true,
      count: courses.length,
      status: dto.status,
    };
	  }

  async batchAdjustPrice(dto: BatchAdjustCoursePriceDto) {
    if (dto.mode === 'fixed' && dto.value < 0) {
      throw new BadRequestException('固定价格不能小于 0');
    }

    const fields = dto.fields || 'both';
    let courses: Course[] = [];
    if (dto.selectAll === true) {
      courses = await this.getCourseList({
        name: dto.name,
        subject: dto.subject,
        category: dto.category,
        subCategory: dto.subCategory,
        status: dto.status,
      });
    } else {
      if (!dto.ids?.length) {
        throw new BadRequestException('课程ID列表不能为空');
      }
      const uniqueIds = Array.from(new Set(dto.ids.map((id) => Number(id)).filter((id) => id > 0)));
      if (uniqueIds.length === 0) {
        throw new BadRequestException('课程ID列表无效');
      }
      courses = await this.courseRepository.find({
        where: { id: In(uniqueIds) },
      });
    }

    if (courses.length === 0) {
      throw new NotFoundException('未找到要调价的课程');
    }

    const updatedCourses: Course[] = [];
    for (const course of courses) {
      if (fields === 'price' || fields === 'both') {
        course.price = this.computeAdjustedPrice(Number(course.price || 0), dto.mode, dto.value);
      }
      if (fields === 'agent_price' || fields === 'both') {
        course.agent_price = this.computeAdjustedPrice(Number(course.agent_price || 0), dto.mode, dto.value);
      }
      const saved = await this.courseRepository.save(course);
      updatedCourses.push(saved);
    }

    return {
      success: true,
      count: updatedCourses.length,
      mode: dto.mode,
      value: dto.value,
      fields,
      selectAll: dto.selectAll === true,
    };
  }

  private validateCoursePriceFields(dto: CreateCourseDto | UpdateCourseDto) {
    const isFree = Number(dto.is_free) === 1;
    if (!isFree && dto.price !== undefined && dto.price !== null) {
      assertIntegerYuanPrice(Number(dto.price), '价格');
    }
    if (dto.agent_price !== undefined && dto.agent_price !== null) {
      assertIntegerYuanPrice(Number(dto.agent_price), '代理商售价');
    }
  }

  private normalizeCoursePrice(value: number): number {
    return ceilIntegerYuanPrice(value);
  }

  private roundCoursePrice(value: number): number {
    return this.normalizeCoursePrice(value);
  }

  private computeAdjustedPrice(current: number, mode: BatchAdjustCoursePriceDto['mode'], value: number): number {
    const base = Number(current) || 0;
    switch (mode) {
      case 'delta':
        return this.roundCoursePrice(base + value);
      case 'percent':
        return this.roundCoursePrice(base * (1 + value / 100));
      case 'fixed':
        return this.roundCoursePrice(value);
      default:
        throw new BadRequestException('不支持的调价方式');
    }
  }

  private async getNextSortValue() {
    const latest = await this.courseRepository
      .createQueryBuilder('course')
      .select('MAX(course.sort)', 'maxSort')
      .getRawOne();
    return Number(latest?.maxSort ?? 0) + 1;
  }
	}
