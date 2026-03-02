import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetCheckinMinutesDto {
  @ApiProperty({ description: '打卡所需时间（分钟）', example: 30, minimum: 1 })
  @IsInt()
  @Min(1)
  minutes: number;
}
