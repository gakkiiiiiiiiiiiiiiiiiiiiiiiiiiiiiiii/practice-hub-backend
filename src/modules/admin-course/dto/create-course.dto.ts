import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCourseDto {
	@ApiProperty({ description: '课程名称', example: '2024年考研数学一' })
	@IsNotEmpty({ message: '课程名称不能为空' })
	@IsString()
	name: string;

	@ApiProperty({ description: '科目', example: '数学', required: false })
	@IsOptional()
	@IsString()
	subject?: string;

	@ApiProperty({ description: '学校', example: '北京大学', required: false })
	@IsOptional()
	@IsString()
	school?: string;

	@ApiProperty({ description: '专业', example: '计算机科学与技术', required: false })
	@IsOptional()
	@IsString()
	major?: string;

	@ApiProperty({ description: '真题年份', example: '2024', required: false })
	@IsOptional()
	@IsString()
	exam_year?: string;

	@ApiProperty({ description: '答案年份', example: '2024', required: false })
	@IsOptional()
	@IsString()
	answer_year?: string;

	@ApiProperty({ description: '封面图片', required: false })
	@IsOptional()
	@IsString()
	cover_img?: string;

	@ApiProperty({ description: '价格', example: 99.99 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	price?: number;

	@ApiProperty({ description: '代理商售价', example: 79.99, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	agent_price?: number;

	@ApiProperty({ description: '是否免费', example: 0, enum: [0, 1] })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	is_free?: number;

	@ApiProperty({ description: '排序', example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	sort?: number;

	@ApiProperty({ description: '课程介绍（富文本）', required: false })
	@IsOptional()
	@IsString()
	introduction?: string;
}
