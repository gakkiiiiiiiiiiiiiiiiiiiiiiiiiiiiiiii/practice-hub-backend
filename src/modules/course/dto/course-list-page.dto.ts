import { ApiProperty } from '@nestjs/swagger';

export class CourseListPageDto<T = Record<string, unknown>> {
  @ApiProperty({ description: '当前页课程摘要' })
  list: T[];

  @ApiProperty({ description: '总课程数', example: 2678 })
  total: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page: number;

  @ApiProperty({ description: '每页条数', example: 50 })
  pageSize: number;

  @ApiProperty({ description: '是否还有下一页', example: true })
  hasMore: boolean;

  constructor(list: T[], total: number, page: number, pageSize: number) {
    this.list = list;
    this.total = total;
    this.page = page;
    this.pageSize = pageSize;
    this.hasMore = page * pageSize < total;
  }
}
