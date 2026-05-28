import { IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackagePlanType } from '../../../database/entities/package-plan.entity';
import { PackageScopeType } from '../../../database/entities/package-section-scope.entity';
import { IsIntegerYuanPrice } from '../../../common/validators/is-integer-yuan-price.validator';

class PackageScopeDto {
	@ApiProperty({ enum: PackageScopeType })
	@IsIn(Object.values(PackageScopeType))
	scope_type: PackageScopeType;

	@ApiPropertyOptional({ description: 'VIP 全站类型可省略，默认 *' })
	@ValidateIf((item) => item.scope_type !== PackageScopeType.ALL)
	@IsString()
	scope_value?: string;
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

	@ApiProperty({ description: '价格（整数元）' })
	@IsNumber()
	@IsInt({ message: '套餐价格必须为整数元' })
	@Min(1, { message: '套餐价格至少为 1 元' })
	@IsIntegerYuanPrice({ message: '套餐价格必须为整数元' })
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
