import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { PreviewWorkerGuard } from './preview-worker.guard';
import {
  PreviewWorkerResult,
  PreviewWorkerService,
} from './preview-worker.service';

@ApiTags('内部预览工作节点')
@Controller('internal/preview-worker')
@UseGuards(PreviewWorkerGuard)
export class PreviewWorkerController {
  constructor(private readonly previewWorkerService: PreviewWorkerService) {}

  @Get('health')
  @ApiOperation({ summary: '预览工作节点连通性检查' })
  health() {
    return CommonResponseDto.success({ ready: true });
  }

  @Get('jobs')
  @ApiOperation({ summary: '分页获取待预热的 PDF 文件' })
  async listJobs(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.previewWorkerService.listJobs(
      Number(cursor || 0),
      Number(limit || 20),
    );
    return CommonResponseDto.success(result);
  }

  @Post('results')
  @ApiOperation({ summary: '回写 PDF 页数与文件版本' })
  async reportResult(@Body() body: PreviewWorkerResult) {
    const result = await this.previewWorkerService.reportResult(body);
    return CommonResponseDto.success(result);
  }
}
