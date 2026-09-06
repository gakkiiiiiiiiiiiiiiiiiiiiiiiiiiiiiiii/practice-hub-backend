import { CourseService } from './course.service';

describe('CourseService', () => {
	const service = Object.create(CourseService.prototype) as CourseService;

	it('applies fuzzy subsequence matching across all searchable course fields', async () => {
		const queryBuilder: any = {
			where: jest.fn(),
			andWhere: jest.fn(),
			orderBy: jest.fn(),
			addOrderBy: jest.fn(),
			select: jest.fn(),
			getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
		};
		Object.values(queryBuilder).forEach((value) => {
			if (typeof value === 'function' && value !== queryBuilder.getManyAndCount) {
				(value as jest.Mock).mockReturnValue(queryBuilder);
			}
		});
		const searchService = Object.create(CourseService.prototype) as CourseService;
		(searchService as any).courseRepository = {
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
		};
		(searchService as any).courseTypeRepository = {
			find: jest.fn().mockResolvedValue([]),
		};

		await searchService.getAllCourses('北大 计算机');

		expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining("COALESCE(course.sub_category, '')"),
			{ fuzzyKeyword0: '%北%大%' },
		);
		expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("COALESCE(course.major, '')"),
			{ fuzzyKeyword1: '%计%算%机%' },
		);
	});

	it.each([
		['资料 --【155页】.pdf', 155],
		['题库 --【112】', 112],
		['讲义 [236页]', 236],
		['复习资料（共 98 页）', 98],
	])('infers page count from the course file name %s', (name, expected) => {
		const result = (service as any).inferPageCountFromCourseFileName({
			display_name: name,
			file_name: name,
		});

		expect(result).toBe(expected);
	});

	it('does not infer a page count from unrelated numbers', () => {
		const result = (service as any).inferPageCountFromCourseFileName({
			display_name: '2026 年经济学第 10 版',
			file_name: 'economics-2026.pdf',
		});

		expect(result).toBeNull();
	});

	it('returns pending PDF health without downloading the OSS source', async () => {
		const healthService = Object.create(CourseService.prototype) as CourseService;
		(healthService as any).courseFileService = {
			getCachedPageCount: jest.fn().mockReturnValue(null),
		};
		(healthService as any).uploadService = {
			readObjectUrlBuffer: jest.fn(),
			downloadObjectUrlToFile: jest.fn(),
		};

		const result = await healthService.inspectCourseFilePdfHealth({
			id: 7,
			course_id: 4,
			file_url: 'https://cdn.example.com/course-files/source.pdf',
			file_type: 'pdf',
			display_name: '资料.pdf',
		});

		expect(result).toMatchObject({
			fileId: 7,
			healthy: null,
			status: 'pending',
			parser: 'aliyun-worker',
		});
		expect((healthService as any).uploadService.readObjectUrlBuffer).not.toHaveBeenCalled();
		expect((healthService as any).uploadService.downloadObjectUrlToFile).not.toHaveBeenCalled();
	});

	it('reports worker-cached PDF page metadata as ready', async () => {
		const healthService = Object.create(CourseService.prototype) as CourseService;
		(healthService as any).courseFileService = {
			getCachedPageCount: jest.fn().mockReturnValue(314),
		};

		const result = await healthService.inspectCourseFilePdfHealth({
			id: 7,
			course_id: 4,
			file_url: 'https://cdn.example.com/course-files/source.pdf',
			file_type: 'pdf',
			display_name: '资料.pdf',
			file_page_count: 314,
			file_page_count_key: 'cached-version',
		});

		expect(result).toMatchObject({
			healthy: true,
			status: 'ready',
			pageCount: 314,
			parser: 'aliyun-worker',
		});
	});
});
