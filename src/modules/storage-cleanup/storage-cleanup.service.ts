import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, LessThan, Repository } from "typeorm";
import { CourseFile } from "../../database/entities/course-file.entity";
import { Course } from "../../database/entities/course.entity";
import {
  StorageDeleteJob,
  StorageDeleteJobStatus,
  StorageDeleteTargetType,
} from "../../database/entities/storage-delete-job.entity";
import { UploadService } from "../upload/upload.service";

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);
  private running = false;

  constructor(
    @InjectRepository(StorageDeleteJob)
    private readonly jobRepository: Repository<StorageDeleteJob>,
    @InjectRepository(CourseFile)
    private readonly courseFileRepository: Repository<CourseFile>,
    @InjectRepository(Course)
    private readonly courseRepository: Repository<Course>,
    private readonly uploadService: UploadService,
    private readonly configService: ConfigService,
  ) {}

  getGracePeriodMs(): number {
    const configuredHours = Number(
      this.configService.get("STORAGE_DELETE_GRACE_HOURS", 24),
    );
    const hours = Math.max(
      0,
      Number.isFinite(configuredHours) ? configuredHours : 24,
    );
    return hours * 60 * 60 * 1000;
  }

  async enqueueUrls(
    urls: Array<string | null | undefined>,
    reason: string,
    manager?: EntityManager,
    delayMs = this.getGracePeriodMs(),
  ): Promise<number> {
    const uniqueUrls = Array.from(
      new Set(urls.map((url) => String(url || "").trim()).filter(Boolean)),
    );
    let count = 0;
    for (const url of uniqueUrls) {
      count += await this.enqueue(
        StorageDeleteTargetType.URL,
        url,
        reason,
        manager,
        delayMs,
      );
    }
    return count;
  }

  async enqueueCoursePreviewPrefix(
    courseId: number,
    reason: string,
    manager?: EntityManager,
    delayMs = this.getGracePeriodMs(),
  ): Promise<number> {
    if (!Number.isInteger(courseId) || courseId <= 0) return 0;
    return this.enqueue(
      StorageDeleteTargetType.PREFIX,
      `course-preview-cache/${courseId}/`,
      reason,
      manager,
      delayMs,
    );
  }

  private async enqueue(
    targetType: StorageDeleteTargetType,
    target: string,
    reason: string,
    manager?: EntityManager,
    delayMs = this.getGracePeriodMs(),
  ): Promise<number> {
    const repository = manager
      ? manager.getRepository(StorageDeleteJob)
      : this.jobRepository;
    const existing = await repository.findOne({
      where: {
        target_type: targetType,
        target,
        status: In([
          StorageDeleteJobStatus.PENDING,
          StorageDeleteJobStatus.PROCESSING,
          StorageDeleteJobStatus.FAILED,
        ]),
      },
    });
    if (existing) {
      if (existing.status !== StorageDeleteJobStatus.PROCESSING) {
        await repository.update(existing.id, {
          status: StorageDeleteJobStatus.PENDING,
          reason: String(reason || "storage_cleanup").slice(0, 100),
          attempts: 0,
          last_error: null,
          delete_after: new Date(Date.now() + Math.max(0, delayMs)),
          locked_at: null,
          finished_at: null,
        });
      }
      return 0;
    }
    await repository.save(
      repository.create({
        target_type: targetType,
        target,
        reason: String(reason || "storage_cleanup").slice(0, 100),
        status: StorageDeleteJobStatus.PENDING,
        attempts: 0,
        max_attempts: Math.max(
          1,
          Number(this.configService.get("STORAGE_DELETE_MAX_ATTEMPTS", 5)) || 5,
        ),
        last_error: null,
        delete_after: new Date(Date.now() + Math.max(0, delayMs)),
        locked_at: null,
        finished_at: null,
      }),
    );
    return 1;
  }

  @Cron(process.env.STORAGE_CLEANUP_CRON || "*/10 * * * *")
  async handleScheduledCleanup(): Promise<void> {
    const enabled = String(
      this.configService.get("STORAGE_CLEANUP_ENABLED", "true"),
    ).toLowerCase();
    if (enabled === "false" || enabled === "0") return;
    await this.processDueJobs();
  }

  async processDueJobs(
    limit = 50,
  ): Promise<{
    processed: number;
    completed: number;
    failed: number;
    skipped: number;
  }> {
    if (this.running)
      return { processed: 0, completed: 0, failed: 0, skipped: 0 };
    this.running = true;
    const summary = { processed: 0, completed: 0, failed: 0, skipped: 0 };
    try {
      await this.recoverStaleJobs();
      const jobs = await this.jobRepository
        .createQueryBuilder("job")
        .where("job.status IN (:...statuses)", {
          statuses: [
            StorageDeleteJobStatus.PENDING,
            StorageDeleteJobStatus.FAILED,
          ],
        })
        .andWhere("job.delete_after <= :now", { now: new Date() })
        .andWhere("job.attempts < job.max_attempts")
        .orderBy("job.delete_after", "ASC")
        .addOrderBy("job.id", "ASC")
        .take(Math.max(1, Math.min(200, limit)))
        .getMany();
      for (const job of jobs) {
        if (!(await this.claimJob(job.id))) continue;
        summary.processed += 1;
        const result = await this.processJob(job);
        summary[result] += 1;
      }
      if (summary.processed) {
        this.logger.log(`对象回收完成: ${JSON.stringify(summary)}`);
      }
      return summary;
    } catch (error: any) {
      this.logger.error(`对象回收任务失败: ${error?.message || error}`);
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
    await this.jobRepository.update(
      {
        status: StorageDeleteJobStatus.PROCESSING,
        locked_at: LessThan(staleBefore),
      },
      {
        status: StorageDeleteJobStatus.FAILED,
        locked_at: null,
        last_error: "处理超时，已重新进入重试队列",
        delete_after: new Date(),
      },
    );
  }

  private async claimJob(id: number): Promise<boolean> {
    const result = await this.jobRepository
      .createQueryBuilder()
      .update(StorageDeleteJob)
      .set({ status: StorageDeleteJobStatus.PROCESSING, locked_at: new Date() })
      .where("id = :id", { id })
      .andWhere("status IN (:...statuses)", {
        statuses: [
          StorageDeleteJobStatus.PENDING,
          StorageDeleteJobStatus.FAILED,
        ],
      })
      .execute();
    return Number(result.affected || 0) === 1;
  }

  private async processJob(
    job: StorageDeleteJob,
  ): Promise<"completed" | "failed" | "skipped"> {
    try {
      if (job.target_type === StorageDeleteTargetType.URL) {
        if (await this.isUrlReferenced(job.target)) {
          await this.finishJob(
            job.id,
            StorageDeleteJobStatus.SKIPPED,
            "文件仍被业务数据引用，已跳过删除",
          );
          return "skipped";
        }
        await this.uploadService.deleteByUrlOrThrow(job.target, [
          "course-files/",
        ]);
      } else {
        await this.uploadService.deleteCoursePreviewPrefix(job.target);
      }
      await this.finishJob(job.id, StorageDeleteJobStatus.COMPLETED, null);
      return "completed";
    } catch (error: any) {
      const attempts = Number(job.attempts || 0) + 1;
      const retryDelay = Math.min(
        24 * 60 * 60 * 1000,
        5 * 60 * 1000 * 2 ** Math.max(0, attempts - 1),
      );
      await this.jobRepository.update(job.id, {
        status: StorageDeleteJobStatus.FAILED,
        attempts,
        locked_at: null,
        last_error: String(error?.message || error || "删除失败").slice(
          0,
          60_000,
        ),
        delete_after: new Date(Date.now() + retryDelay),
        finished_at:
          attempts >= Number(job.max_attempts || 5) ? new Date() : null,
      });
      this.logger.warn(
        `对象删除失败 job=${job.id} attempt=${attempts}: ${error?.message || error}`,
      );
      return "failed";
    }
  }

  private async isUrlReferenced(url: string): Promise<boolean> {
    const [courseFileCount, courseCount] = await Promise.all([
      this.courseFileRepository.count({ where: { file_url: url } }),
      this.courseRepository.count({
        where: [{ file_url: url }, { cover_img: url }],
      }),
    ]);
    return courseFileCount + courseCount > 0;
  }

  private async finishJob(
    id: number,
    status: StorageDeleteJobStatus,
    message: string | null,
  ): Promise<void> {
    await this.jobRepository.update(id, {
      status,
      attempts: () => "attempts + 1",
      locked_at: null,
      last_error: message,
      finished_at: new Date(),
    });
  }
}
