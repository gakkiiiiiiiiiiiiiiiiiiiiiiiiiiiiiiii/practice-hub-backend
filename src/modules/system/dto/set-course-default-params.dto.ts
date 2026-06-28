import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsIntegerYuanPrice } from '../../../common/validators/is-integer-yuan-price.validator';

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

	@ApiProperty({ description: '用户售价（整数元）', example: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '用户售价必须为整数元' })
	@Min(0)
	@IsIntegerYuanPrice()
	price?: number;

	@ApiProperty({ description: '代理商售价（整数元）', example: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '代理商售价必须为整数元' })
	@Min(0)
	@IsIntegerYuanPrice()
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

	@ApiProperty({ description: '课程内容类型', example: 'normal', enum: ['normal', 'file', 'paper_exam'] })
	@IsOptional()
	@IsString()
	@IsIn(['normal', 'file', 'paper_exam'])
	content_type?: string;

	@ApiProperty({ description: '课程状态', example: 0, enum: [0, 1] })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@IsIn([0, 1])
	status?: number;
}
