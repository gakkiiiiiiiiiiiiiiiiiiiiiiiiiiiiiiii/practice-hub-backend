import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyDistributorDto {
	@ApiProperty({ description: '申请理由（可选）', required: false })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	reason?: string;
}

