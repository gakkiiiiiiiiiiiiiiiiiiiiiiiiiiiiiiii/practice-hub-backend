import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsIn } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ description: '状态', example: 0, enum: [0, 1] })
  @IsNotEmpty({ message: '状态不能为空' })
  @IsNumber()
  @IsIn([0, 1], { message: '状态值只能是 0 或 1' })
  status: number; // 0-封禁, 1-解封
}

