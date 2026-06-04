import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SetCourseSimilarityConfigDto {
  @ApiPropertyOptional({
    description: '名称编辑距离相似度阈值（0.5-0.99），默认 0.82',
    example: 0.82,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(0.99)
  threshold?: number;
}
