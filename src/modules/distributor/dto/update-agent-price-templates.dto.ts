import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class AgentPriceTemplateItemDto {
  @ApiProperty({
    description: "代理商等级",
    minimum: 1,
    maximum: 3,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  level: number;

  @ApiProperty({ description: "是否启用该等级模板", example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: "代理商折扣，单位为折",
    minimum: 0.1,
    maximum: 10,
    example: 4,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 }, { message: "折扣最多保留一位小数" })
  @Min(0.1)
  @Max(10)
  discount: number;
}

export class UpdateAgentPriceTemplatesDto {
  @ApiProperty({
    description: "各级代理价格模板",
    type: [AgentPriceTemplateItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AgentPriceTemplateItemDto)
  templates: AgentPriceTemplateItemDto[];

  @ApiProperty({ description: "不应用代理价的课程分类 ID", type: [Number] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  category_ids: number[];

  @ApiProperty({ description: "不应用代理价的套餐 ID", type: [Number] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  package_section_ids: number[];
}

export class ApplyAgentPriceTemplatesDto {
  @ApiPropertyOptional({
    description: "仅应用指定等级；不传则应用全部已启用模板",
    minimum: 1,
    maximum: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  agent_level?: number;
}
