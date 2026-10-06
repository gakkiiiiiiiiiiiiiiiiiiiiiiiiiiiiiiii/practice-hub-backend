import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCourseDto } from './create-course.dto';

describe('CreateCourseDto', () => {
	it('accepts multiple year ranges used by paper exam courses', async () => {
		const dto = plainToInstance(CreateCourseDto, {
			name: '云南大学333教育综合',
			exam_year: '2010-2014、2019、2021-2025',
			answer_year: '2010-2014、2019、2021-2025',
			price: 80,
			agent_price: 80,
			is_free: 0,
			content_type: 'paper_exam',
		});

		await expect(validate(dto)).resolves.toEqual([]);
	});

	it('rejects year descriptions longer than the database columns', async () => {
		const dto = plainToInstance(CreateCourseDto, {
			name: '测试课程',
			exam_year: '2'.repeat(101),
			answer_year: '2'.repeat(101),
			price: 80,
			is_free: 0,
		});

		const errors = await validate(dto);
		expect(errors.some((error) => error.property === 'exam_year')).toBe(true);
		expect(errors.some((error) => error.property === 'answer_year')).toBe(true);
	});
});
