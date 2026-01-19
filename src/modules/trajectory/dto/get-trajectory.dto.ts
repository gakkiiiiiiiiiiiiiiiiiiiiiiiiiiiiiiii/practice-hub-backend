import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsIn } from 'class-validator';

export class GetTrajectoryDto {
	@ApiProperty({ description: '时间筛选：week-本周, month-本月, all-全部', example: 'week', required: false })
	@IsOptional()
	@IsIn(['week', 'month', 'all'], { message: '时间筛选只能是 week、month 或 all' })
	period?: 'week' | 'month' | 'all';
}
