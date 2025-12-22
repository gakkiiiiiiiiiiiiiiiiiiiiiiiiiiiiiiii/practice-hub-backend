import { ApiProperty } from '@nestjs/swagger';

export class CommonResponseDto<T = any> {
  @ApiProperty({ description: '状态码', example: 200 })
  code: number;

  @ApiProperty({ description: '提示信息', example: 'success' })
  msg: string;

  @ApiProperty({ description: '业务数据' })
  data: T;

  static success<T>(data: T, msg = 'success'): CommonResponseDto<T> {
    return {
      code: 200,
      msg,
      data,
    };
  }

  static error(code: number, msg: string): CommonResponseDto<null> {
    return {
      code,
      msg,
      data: null,
    };
  }
}

