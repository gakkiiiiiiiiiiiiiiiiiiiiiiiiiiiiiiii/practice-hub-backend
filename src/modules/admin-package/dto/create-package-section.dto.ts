import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackagePlanType } from '../../../database/entities/package-plan.entity';
import { PackageScopeType } from '../../../database/entities/package-section-scope.entity';

class VipScopeDto {
	@ApiProperty({ enum: PackageScopeType })
	@IsIn(Object.values(PackageScopeType))
	scope_type: PackageScopeType;

	@ApiProperty()
	@IsString()
	scope_value: string;
}

class PackagePlanDto {
	@ApiProperty({ enum: PackagePlanType })
	@IsIn(Object.values(PackagePlanType))
	plan_type: PackagePlanType;

	@ApiProperty()
	@IsString()
	name: string;

	@ApiProperty()
	@IsNumber()
	@Min(0)
	price: number;

	@ApiProperty()
	@IsNumber()
	@Min(1)
	duration_days: number;

	@ApiPropertyOptional()
	@IsOptional()
	@IsNumber()
	status?: number;

	@ApiPropertyOptional()
	@IsOptional()
	@IsNumber()
	sort?: number;
}

export class CreatePackageSectionDto {
	@ApiProperty()
	@IsString()
	name: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	description?: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	cover_img?: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsNumber()
	status?: number;

	@ApiPropertyOptional()
	@IsOptional()
	@IsNumber()
	sort?: number;

	@ApiPropertyOptional({ type: [VipScopeDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => VipScopeDto)
	scopes?: VipScopeDto[];

	@ApiPropertyOptional({ type: [PackagePlanDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PackagePlanDto)
	plans?: PackagePlanDto[];
}

export class UpdatePackageSectionDto extends CreatePackageSectionDto {}
