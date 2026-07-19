import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class BatchUpdateCourseContentDto {
	@ApiProperty({ enum: ['selected', 'category'], description: '更新范围：已选课程或指定类目全部课程' })
	@IsIn(['selected', 'category'])
	scope: 'selected' | 'category';

	@ApiProperty({ type: [Number], required: false, description: 'scope=selected 时的课程 ID' })
	@ValidateIf((dto: BatchUpdateCourseContentDto) => dto.scope === 'selected')
	@IsArray()
	@ArrayMinSize(1, { message: '请至少选择一门课程' })
	@IsInt({ each: true })
	ids?: number[];

	@ApiProperty({ required: false, description: 'scope=category 时的一级分类' })
	@ValidateIf((dto: BatchUpdateCourseContentDto) => dto.scope === 'category')
	@IsString()
	@IsNotEmpty({ message: '请选择一级分类' })
	category?: string;

	@ApiProperty({ required: false, description: '二级分类；不传则包含一级分类下全部课程' })
	@IsOptional()
	@IsString()
	subCategory?: string;

	@ApiProperty({ required: false, description: '统一替换后的课程介绍（富文本）' })
	@IsOptional()
	@IsString()
	introduction?: string;

	@ApiProperty({ required: false, minimum: 0, maximum: 50, description: '文件课程试读预览页数' })
	@IsOptional()
	@IsInt({ message: '预览页数必须是整数' })
	@Min(0)
	@Max(50)
	trial_preview_page_count?: number;
}
