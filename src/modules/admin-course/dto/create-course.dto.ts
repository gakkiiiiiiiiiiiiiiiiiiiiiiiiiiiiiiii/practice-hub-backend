import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

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
	@IsNumber()
	price?: number;

	@ApiProperty({ description: '是否VIP免费', example: 0, enum: [0, 1] })
	@IsOptional()
	@IsNumber()
	is_vip_free?: number;

	@ApiProperty({ description: '排序', example: 0 })
	@IsOptional()
	@IsNumber()
	sort?: number;
}
