import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsIn, Min, ValidateIf, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { IsIntegerYuanPrice } from '../../../common/validators/is-integer-yuan-price.validator';

export class CreateCourseDto {
	@ApiProperty({ description: '课程名称', example: '2024年考研数学一' })
	@IsNotEmpty({ message: '课程名称不能为空' })
	@IsString()
	name: string;

	@ApiProperty({ description: '科目', example: '数学', required: false })
	@IsOptional()
	@IsString()
	subject?: string;

	@ApiProperty({ description: '一级分类', example: '考研政治', required: false })
	@IsOptional()
	@IsString()
	category?: string;

	@ApiProperty({ description: '二级分类', example: '真题', required: false })
	@IsOptional()
	@IsString()
	sub_category?: string;

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

	@ApiProperty({ description: '价格（整数元）', example: 99 })
	@ValidateIf((dto) => dto.is_free !== 1)
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '价格必须为整数元' })
	@Min(1, { message: '付费课程价格至少为 1 元' })
	@IsIntegerYuanPrice({ message: '价格必须为整数元' })
	price?: number;

	@ApiProperty({ description: '代理商售价（整数元）', example: 79, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsInt({ message: '代理商售价必须为整数元' })
	@Min(0, { message: '代理商售价不能为负数' })
	@IsIntegerYuanPrice({ message: '代理商售价必须为整数元' })
	agent_price?: number;

	@ApiProperty({ description: '是否免费', example: 0, enum: [0, 1] })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	is_free?: number;

	@ApiProperty({ description: '有效期天数（仅付费课程有效），null表示永久有效', example: 30, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	validity_days?: number | null;

	@ApiProperty({ description: '排序', example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	sort?: number;

	@ApiProperty({ description: '课程介绍（富文本）', required: false })
	@IsOptional()
	@IsString()
	introduction?: string;

	@ApiProperty({ description: '课程内容类型：normal=普通题库，file=文件课程', example: 'normal', required: false })
	@IsOptional()
	@IsString()
	content_type?: string;

	@ApiProperty({ description: '文件课程：文件 URL', required: false })
	@IsOptional()
	@IsString()
	file_url?: string;

	@ApiProperty({ description: '文件课程：文件名称', required: false })
	@IsOptional()
	@IsString()
	file_name?: string;

	@ApiProperty({ description: '文件课程：文件类型 pdf/doc/docx', required: false })
	@IsOptional()
	@IsString()
	file_type?: string;

	@ApiProperty({ description: '文件课程：文件大小（字节）', required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	file_size?: number;

	@ApiProperty({ description: '文件课程：是否允许用户查看源文件，0=否，1=是', example: 0, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	allow_source_file?: number;

	@ApiProperty({ description: '状态：0-禁用，1-启用', example: 1, required: false })
	@IsOptional()
	@Type(() => Number)
	@IsIn([0, 1], { message: 'status 必须为 0 或 1' })
	status?: number;
}
