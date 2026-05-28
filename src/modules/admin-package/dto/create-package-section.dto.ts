import { IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackagePlanType } from '../../../database/entities/package-plan.entity';
import { PackageScopeType } from '../../../database/entities/package-section-scope.entity';

class PackageScopeDto {
	@ApiProperty({ enum: PackageScopeType })
	@IsIn(Object.values(PackageScopeType))
	scope_type: PackageScopeType;

	@ApiProperty()
	@IsString()
	scope_value: string;
}

class PackageCoverStyleDto {
	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	backgroundColor?: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	titleColor?: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	categoriesColor?: string;
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
	@IsObject()
	cover_style?: PackageCoverStyleDto | null;

	@ApiPropertyOptional()
	@IsOptional()
	@IsNumber()
	status?: number;

	@ApiPropertyOptional()
	@IsOptional()
	@IsNumber()
	sort?: number;

	@ApiPropertyOptional({ type: [PackageScopeDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PackageScopeDto)
	scopes?: PackageScopeDto[];

	@ApiPropertyOptional({ type: [PackagePlanDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PackagePlanDto)
	plans?: PackagePlanDto[];
}

export class UpdatePackageSectionDto extends CreatePackageSectionDto {}
