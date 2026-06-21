import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';
import { ActivationCodeTargetType } from '../../../database/entities/activation-code.entity';

export class GenerateCodeDto {
  @ApiProperty({ description: '目标类型：course=课程，package=套餐/VIP', example: 'course', required: false })
  @IsOptional()
  @IsIn([ActivationCodeTargetType.COURSE, ActivationCodeTargetType.PACKAGE])
  target_type?: ActivationCodeTargetType;

  @ApiProperty({ description: '目标ID：课程ID或套餐计划ID', example: 1, required: false })
  @ValidateIf((dto) => !!dto.target_type)
  @IsNotEmpty({ message: '目标ID不能为空' })
  @IsNumber()
  target_id?: number;

  @ApiProperty({ description: '课程ID（兼容旧字段）', example: 1, required: false })
  @ValidateIf((dto) => (!dto.target_type || dto.target_type === ActivationCodeTargetType.COURSE) && !dto.target_id)
  @IsNotEmpty({ message: '课程ID不能为空' })
  @IsNumber()
  course_id?: number;

  @ApiProperty({ description: '生成数量', example: 100 })
  @IsNotEmpty({ message: '生成数量不能为空' })
  @IsNumber()
  @Min(1, { message: '生成数量必须大于0' })
  count: number;

  @ApiProperty({ description: '单价（可选，用于扣除余额）', example: 0.1, required: false })
  @IsOptional()
  @IsNumber()
  price?: number;
}
