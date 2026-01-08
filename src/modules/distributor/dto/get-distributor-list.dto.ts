import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetDistributorListDto {
	@ApiProperty({ description: '状态筛选（0-待审核, 1-已通过, 2-已拒绝, 3-已禁用）', required: false })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) || !Number.isFinite(num) ? undefined : num;
	})
	@IsNumber({}, { message: '状态必须是数字' })
	status?: number;

	@ApiProperty({ description: '页码', example: 1, required: false, default: 1 })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return 1;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) || !Number.isFinite(num) || num < 1 ? 1 : num;
	})
	@IsNumber({}, { message: '页码必须是数字' })
	@Min(1)
	page?: number;

	@ApiProperty({ description: '每页数量', example: 20, required: false, default: 20 })
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === '') {
			return 20;
		}
		const num = typeof value === 'number' ? value : parseInt(String(value), 10);
		return isNaN(num) || !Number.isFinite(num) || num < 1 ? 20 : num;
	})
	@IsNumber({}, { message: '每页数量必须是数字' })
	@Min(1)
	pageSize?: number;
}
