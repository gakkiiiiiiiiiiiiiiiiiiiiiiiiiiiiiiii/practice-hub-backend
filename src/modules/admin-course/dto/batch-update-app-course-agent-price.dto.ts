import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, Max, Min } from 'class-validator';

export class BatchUpdateAppCourseAgentPriceDto {
	@ApiProperty({ description: '代理商等级', minimum: 1, maximum: 3, example: 2 })
	@Type(() => Number)
	@IsInt({ message: '代理商等级必须是整数' })
	@Min(1, { message: '代理商等级不能低于 1' })
	@Max(3, { message: '代理商等级不能高于 3' })
	agent_level: number;

	@ApiProperty({ description: '需要批量设置代理商售价的课程 ID', type: [Number], example: [1, 2, 3] })
	@IsArray({ message: '课程 ID 列表必须是数组' })
	@ArrayMinSize(1, { message: '请至少选择一份资料' })
	@ArrayMaxSize(10000, { message: '单次最多设置 10000 份资料' })
	@IsInt({ each: true, message: '课程 ID 必须是整数' })
	@Min(1, { each: true, message: '课程 ID 必须大于 0' })
	course_ids: number[];

	@ApiProperty({ description: '代理商折扣，单位为折；例如 8.5 表示普通售价的 85%', example: 8.5 })
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 1 }, { message: '折扣最多保留一位小数' })
	@Min(0.1, { message: '折扣不能低于 0.1 折' })
	@Max(10, { message: '折扣不能高于 10 折' })
	discount: number;
}
