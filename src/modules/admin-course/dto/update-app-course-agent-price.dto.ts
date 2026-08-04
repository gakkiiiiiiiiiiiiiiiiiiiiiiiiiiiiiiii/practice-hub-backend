import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { IsIntegerYuanPrice } from '../../../common/validators/is-integer-yuan-price.validator';

export class UpdateAppCourseAgentPriceDto {
	@ApiProperty({ description: '代理商售价（整数元）；0 表示按课程原价销售', example: 79 })
	@Type(() => Number)
	@IsInt({ message: '代理商售价必须为整数元' })
	@Min(0, { message: '代理商售价不能为负数' })
	@Max(1000000, { message: '代理商售价不能超过 1000000 元' })
	@IsIntegerYuanPrice({ message: '代理商售价必须为整数元' })
	agent_price: number;
}
