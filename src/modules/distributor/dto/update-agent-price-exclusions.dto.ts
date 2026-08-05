import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

export class UpdateAgentPriceExclusionsDto {
	@ApiProperty({ description: '不享受代理价的课程分类 ID', type: [Number], example: [1, 12] })
	@IsArray({ message: '分类 ID 列表必须是数组' })
	@ArrayMaxSize(1000, { message: '最多排除 1000 个分类' })
	@IsInt({ each: true, message: '分类 ID 必须是整数' })
	@Min(1, { each: true, message: '分类 ID 必须大于 0' })
	category_ids: number[];

	@ApiProperty({ description: '套餐商品本身不享受代理价的套餐 ID（不影响套餐包含的课程）', type: [Number], example: [2, 5] })
	@IsArray({ message: '套餐 ID 列表必须是数组' })
	@ArrayMaxSize(1000, { message: '最多排除 1000 个套餐' })
	@IsInt({ each: true, message: '套餐 ID 必须是整数' })
	@Min(1, { each: true, message: '套餐 ID 必须大于 0' })
	package_section_ids: number[];
}
