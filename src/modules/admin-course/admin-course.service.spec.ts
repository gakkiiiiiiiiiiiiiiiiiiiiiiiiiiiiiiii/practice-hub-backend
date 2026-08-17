import { BadRequestException } from '@nestjs/common';
import { AdminCourseService } from './admin-course.service';
import { Course } from '../../database/entities/course.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Question } from '../../database/entities/question.entity';
import { ExamConfig } from '../../database/entities/exam-config.entity';
import { ActivationCode, ActivationCodeStatus } from '../../database/entities/activation-code.entity';

describe('AdminCourseService getCourseList', () => {
	it('filters courses whose primary category is null or blank', async () => {
		const query = {
			select: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			addOrderBy: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue([]),
		};
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		(service as any).courseRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(query),
		};

		await expect(service.getCourseList({ uncategorizedOnly: true })).resolves.toEqual([]);

		expect(query.andWhere).toHaveBeenCalledWith("(course.category IS NULL OR TRIM(course.category) = '')");
	});
});

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

describe('AdminCourseService updateCourseAgentPrice', () => {
	it('updates only the selected course agent price', async () => {
		const course = { id: 12, name: '护理学', price: 20, agent_price: 6 };
		const repository = {
			findOne: jest.fn().mockResolvedValue(course),
			save: jest.fn((value) => Promise.resolve(value)),
		};
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		(service as any).courseRepository = repository;

		await expect(service.updateCourseAgentPrice(12, 8, 1)).resolves.toEqual({
			id: 12,
			name: '护理学',
			price: 20,
			agent_price: 8,
			agent_prices: { '1': 8 },
			agent_level: 1,
			effective_agent_price: 8,
		});
		expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 12 } });
		expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 12, agent_price: 8 }));
	});

	it('sets multiple agent prices from the normal price and a Chinese discount', async () => {
		const courses = [
			{ id: 12, name: '护理学', price: 20, agent_price: 6 },
			{ id: 13, name: '内科学', price: 99, agent_price: 50 },
		];
		const repository = {
			find: jest.fn().mockResolvedValue(courses),
			save: jest.fn((values) => Promise.resolve(values)),
		};
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		(service as any).courseRepository = repository;

		await expect(service.batchUpdateCourseAgentPricesByDiscount([12, 13], 8.5, 2)).resolves.toMatchObject({
			count: 2,
			discount: 8.5,
			courses: [
				{ id: 12, price: 20, agent_price: 6, agent_prices: { '2': 17 } },
				{ id: 13, price: 99, agent_price: 50, agent_prices: { '2': 85 } },
			],
		});
		expect(repository.save).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ id: 12, agent_prices: { '2': 17 } }),
				expect.objectContaining({ id: 13, agent_prices: { '2': 85 } }),
			]),
			{ chunk: 500 },
		);
	});

	it('rejects fractional agent prices', async () => {
		const service = Object.create(AdminCourseService.prototype) as AdminCourseService;
		await expect(service.updateCourseAgentPrice(12, 8.5)).rejects.toBeInstanceOf(BadRequestException);
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
