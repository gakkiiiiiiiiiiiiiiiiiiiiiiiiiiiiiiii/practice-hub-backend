import { BadRequestException } from '@nestjs/common';
import { AdminCourseService } from './admin-course.service';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Question } from '../../database/entities/question.entity';
import { ExamConfig } from '../../database/entities/exam-config.entity';
import { ActivationCode, ActivationCodeStatus } from '../../database/entities/activation-code.entity';

describe('AdminCourseService batchUpdateContent', () => {
	function createService(courses: Array<{ id: number; content_type: string }>) {
		const query = {
			select: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue(courses),
		};
		const repository = {
			createQueryBuilder: jest.fn().mockReturnValue(query),
			update: jest.fn().mockResolvedValue({ affected: courses.length }),
		};
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		(service as any).courseRepository = repository;
		return { service, repository, query };
	}

	it('updates introductions for all targets and preview pages only for file courses', async () => {
		const { service, repository } = createService([
			{ id: 1, content_type: 'file' },
			{ id: 2, content_type: 'normal' },
		]);
		repository.update
			.mockResolvedValueOnce({ affected: 2 })
			.mockResolvedValueOnce({ affected: 1 });

		const result = await service.batchUpdateContent({
			scope: 'category',
			category: '考研专业课',
			introduction: '<p>统一介绍</p>',
			trial_preview_page_count: 5,
		});

		expect(repository.update).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			targetCount: 2,
			introductionCount: 2,
			previewPageCount: 1,
			skippedNonFileCount: 1,
		});
	});

	it('rejects requests without a selected update field', async () => {
		const { service } = createService([{ id: 1, content_type: 'file' }]);

		await expect(service.batchUpdateContent({ scope: 'selected', ids: [1] })).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});
});

describe('AdminCourseService getCourseFileDownloadUrl', () => {
	it('returns a signed URL only after resolving the file under the requested course', async () => {
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		const file = {
			id: 180,
			course_id: 186,
			file_url: 'https://cdn.example.com/course-files/material.pdf',
			file_name: '材料科学基础.pdf',
			display_name: '材料科学基础',
		};
		(service as any).courseFileService = {
			resolve: jest.fn().mockResolvedValue(file),
		};
		(service as any).courseService = {
			getAuthorizedCourseFileUrl: jest
				.fn()
				.mockReturnValue(`${file.file_url}?auth_key=signed`),
		};

		await expect(service.getCourseFileDownloadUrl(186, 180)).resolves.toEqual({
			url: `${file.file_url}?auth_key=signed`,
			fileName: file.file_name,
		});
		expect((service as any).courseFileService.resolve).toHaveBeenCalledWith(186, 180);
	});
});

describe('AdminCourseService batchDeleteCourses', () => {
	it('invalidates pending activation codes and clears their course foreign key in one transaction', async () => {
		const course = { id: 12, file_url: 'https://cdn.example.com/course.pdf' };
		const courseRepository = {
			find: jest.fn().mockResolvedValue([course]),
			findOne: jest.fn().mockResolvedValue(course),
			remove: jest.fn().mockResolvedValue(course),
		};
		const chapterRepository = { find: jest.fn().mockResolvedValue([]), delete: jest.fn() };
		const questionRepository = { find: jest.fn(), delete: jest.fn() };
		const examConfigRepository = { find: jest.fn().mockResolvedValue([]), delete: jest.fn() };
		const activationCodeRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
		const genericRepository = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
		const repositories = new Map<any, any>([
			[Course, courseRepository],
			[Chapter, chapterRepository],
			[Question, questionRepository],
			[ExamConfig, examConfigRepository],
			[ActivationCode, activationCodeRepository],
		]);
		const manager = {
			getRepository: jest.fn((entity) => repositories.get(entity) || genericRepository),
		};
		const dataSource = {
			transaction: jest.fn(async (callback) => callback(manager)),
		};
		const courseFileService = {
			removeAllForCourse: jest.fn().mockResolvedValue([]),
		};
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		(service as any).dataSource = dataSource;
		(service as any).courseFileService = courseFileService;

		await expect(service.batchDeleteCourses({ ids: [12, 12] })).resolves.toEqual({
			success: true,
			count: 1,
		});
		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		expect(activationCodeRepository.update).toHaveBeenNthCalledWith(
			1,
			{ course_id: 12, status: ActivationCodeStatus.PENDING },
			{ status: ActivationCodeStatus.INVALID },
		);
		expect(activationCodeRepository.update).toHaveBeenNthCalledWith(
			2,
			{ course_id: 12 },
			{ course_id: null },
		);
		expect(courseFileService.removeAllForCourse).toHaveBeenCalledWith(
			12,
			manager,
			course.file_url,
		);
		expect(courseRepository.remove).toHaveBeenCalledWith(course);
	});
});
