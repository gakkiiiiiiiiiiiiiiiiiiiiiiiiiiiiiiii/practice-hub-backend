import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SetCountdownDto {
  @ApiProperty({ description: '倒计时日期', example: '2024-12-23' })
  @IsNotEmpty({ message: '日期不能为空' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式不正确，应为 YYYY-MM-DD' })
  date: string;
}

