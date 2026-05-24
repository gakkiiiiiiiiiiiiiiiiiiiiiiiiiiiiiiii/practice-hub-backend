import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SetCourseDefaultParamsDto {
	@ApiProperty({ description: '课程（科目标签）', required: false })
	@IsOptional()
	@IsString()
	subject?: string;

	@ApiProperty({ description: '学校', required: false })
	@IsOptional()
	@IsString()
	school?: string;

	@ApiProperty({ description: '专业', required: false })
	@IsOptional()
	@IsString()
	major?: string;

	@ApiProperty({ description: '真题年份', required: false })
	@IsOptional()
	@IsString()
	exam_year?: string;

	@ApiProperty({ description: '答案年份', required: false })
	@IsOptional()
	@IsString()
	answer_year?: string;

	@ApiProperty({ description: '用户售价', example: 0.5 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price?: number;

	@ApiProperty({ description: '代理商售价', example: 0.1 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	agent_price?: number;

	@ApiProperty({ description: '是否免费', example: 0, enum: [0, 1] })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@IsIn([0, 1])
	is_free?: number;

	@ApiProperty({ description: '有效期天数，null 表示永久', example: 365, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	validity_days?: number | null;

	@ApiProperty({ description: '是否允许查看源文件', example: 0, enum: [0, 1] })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@IsIn([0, 1])
	allow_source_file?: number;

	@ApiProperty({ description: '课程内容类型', example: 'normal', enum: ['normal', 'file'] })
	@IsOptional()
	@IsString()
	@IsIn(['normal', 'file'])
	content_type?: string;
}
