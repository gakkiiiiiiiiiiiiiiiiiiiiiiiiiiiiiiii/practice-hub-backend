import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import {
  StorageDeleteJob,
  StorageDeleteJobStatus,
  StorageDeleteTargetType,
} from "../../database/entities/storage-delete-job.entity";
import { CourseFile } from "../../database/entities/course-file.entity";
import { Course } from "../../database/entities/course.entity";
import { UploadService } from "../upload/upload.service";
import { StorageCleanupService } from "./storage-cleanup.service";

describe("StorageCleanupService", () => {
  const createService = (courseFileReferences = 0, courseReferences = 0) => {
    const jobRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<StorageDeleteJob>>;
    const courseFileRepository = {
      count: jest.fn().mockResolvedValue(courseFileReferences),
    } as unknown as jest.Mocked<Repository<CourseFile>>;
    const courseRepository = {
      count: jest.fn().mockResolvedValue(courseReferences),
    } as unknown as jest.Mocked<Repository<Course>>;
    const uploadService = {
      deleteByUrlOrThrow: jest.fn().mockResolvedValue(undefined),
      deleteCoursePreviewPrefix: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<UploadService>;
    const configService = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
    } as unknown as jest.Mocked<ConfigService>;
    const service = new StorageCleanupService(
      jobRepository,
      courseFileRepository,
      courseRepository,
      uploadService,
      configService,
    );
    return { service, jobRepository, uploadService };
  };

  const createJob = (
    overrides: Partial<StorageDeleteJob> = {},
  ): StorageDeleteJob =>
    ({
      id: 1,
      target_type: StorageDeleteTargetType.URL,
      target:
        "https://example.oss-cn-shanghai.aliyuncs.com/course-files/example.pdf",
      reason: "course_file_deleted",
      status: StorageDeleteJobStatus.PROCESSING,
      attempts: 0,
      max_attempts: 5,
      last_error: null,
      delete_after: new Date(),
      locked_at: new Date(),
      finished_at: null,
      create_time: new Date(),
      update_time: new Date(),
      ...overrides,
    }) as StorageDeleteJob;

  it("skips deletion when a business record still references the URL", async () => {
    const { service, jobRepository, uploadService } = createService(1, 0);

    const result = await (service as any).processJob(createJob());

    expect(result).toBe("skipped");
    expect(uploadService.deleteByUrlOrThrow).not.toHaveBeenCalled();
    expect(jobRepository.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: StorageDeleteJobStatus.SKIPPED }),
    );
  });

  it("deletes an unreferenced managed course file", async () => {
    const { service, jobRepository, uploadService } = createService();

    const result = await (service as any).processJob(createJob());

    expect(result).toBe("completed");
    expect(uploadService.deleteByUrlOrThrow).toHaveBeenCalledWith(
      expect.stringContaining("/course-files/example.pdf"),
      ["course-files/"],
    );
    expect(jobRepository.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: StorageDeleteJobStatus.COMPLETED }),
    );
  });

  it("records a retry when object deletion fails", async () => {
    const { service, jobRepository, uploadService } = createService();
    (uploadService.deleteByUrlOrThrow as jest.Mock).mockRejectedValueOnce(
      new Error("OSS unavailable"),
    );

    const result = await (service as any).processJob(
      createJob({ attempts: 1 }),
    );

    expect(result).toBe("failed");
    expect(jobRepository.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: StorageDeleteJobStatus.FAILED,
        attempts: 2,
        last_error: "OSS unavailable",
      }),
    );
  });

  it("deletes a course preview cache prefix", async () => {
    const { service, uploadService } = createService();
    const job = createJob({
      target_type: StorageDeleteTargetType.PREFIX,
      target: "course-preview-cache/42/",
    });

    const result = await (service as any).processJob(job);

    expect(result).toBe("completed");
    expect(uploadService.deleteCoursePreviewPrefix).toHaveBeenCalledWith(
      "course-preview-cache/42/",
    );
  });

  it("restarts the grace period when the same URL is enqueued again", async () => {
    const { service, jobRepository } = createService();
    (jobRepository.findOne as jest.Mock).mockResolvedValueOnce(
      createJob({ status: StorageDeleteJobStatus.PENDING }),
    );
    const before = Date.now();

    const created = await service.enqueueUrls(
      ["https://example.oss-cn-shanghai.aliyuncs.com/course-files/example.pdf"],
      "course_file_deleted_again",
      undefined,
      60_000,
    );

    expect(created).toBe(0);
    expect(jobRepository.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: StorageDeleteJobStatus.PENDING,
        reason: "course_file_deleted_again",
        attempts: 0,
      }),
    );
    const updatePatch = (jobRepository.update as jest.Mock).mock.calls[0][1];
    expect(updatePatch.delete_after.getTime()).toBeGreaterThanOrEqual(
      before + 60_000,
    );
  });
});
