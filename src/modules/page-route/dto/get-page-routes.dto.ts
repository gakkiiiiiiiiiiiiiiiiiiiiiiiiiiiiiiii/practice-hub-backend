import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetPageRoutesDto {
	@ApiProperty({ description: '页面类型筛选（main-主包，sub-子包，tabBar-tabBar页面）', required: false })
	@IsOptional()
	@IsString()
	type?: string;

	@ApiProperty({ description: '状态筛选（0-禁用，1-启用）', required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) ? undefined : num;
	})
	@IsNumber({}, { message: '状态必须是数字' })
	status?: number;
}
