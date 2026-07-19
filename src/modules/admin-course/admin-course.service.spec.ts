import { BadRequestException } from '@nestjs/common';
import { AdminCourseService } from './admin-course.service';

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
