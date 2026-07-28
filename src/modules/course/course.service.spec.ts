import { CourseService } from './course.service';

describe('CourseService preview metadata', () => {
	const service = Object.create(CourseService.prototype) as CourseService;

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
