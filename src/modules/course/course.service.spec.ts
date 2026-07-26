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
});
