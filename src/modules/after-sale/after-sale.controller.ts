import { Controller, Post, Body, Get, Param, Query, UseGuards, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AfterSaleService } from './after-sale.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateAfterSaleDto } from './dto/create-after-sale.dto';
import { ProcessAfterSaleDto } from './dto/process-after-sale.dto';

@ApiTags('售后')
@Controller('app/after-sale')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AfterSaleController {
  constructor(private readonly afterSaleService: AfterSaleService) {}

  @Post('create')
  @ApiOperation({ summary: '创建售后申请' })
  async createAfterSale(@CurrentUser() user: any, @Body() dto: CreateAfterSaleDto) {
    const result = await this.afterSaleService.createAfterSale(user.userId, dto);
    return CommonResponseDto.success(result);
  }

  @Get('list')
  @ApiOperation({ summary: '获取用户的售后申请列表' })
  async getUserAfterSaleList(@CurrentUser() user: any) {
    const result = await this.afterSaleService.getUserAfterSaleList(user.userId);
    return CommonResponseDto.success(result);
  }
}

@ApiTags('售后管理')
@Controller('admin/after-sale')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminAfterSaleController {
  constructor(private readonly afterSaleService: AfterSaleService) {}

  @Get('list')
  @ApiOperation({ summary: '获取所有售后申请列表' })
  async getAfterSaleList(
    @Query('status') status?: number,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.afterSaleService.getAfterSaleList(
      status ? Number(status) : undefined,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 10,
    );
    return CommonResponseDto.success(result);
  }

  @Put(':id/process')
  @ApiOperation({ summary: '处理售后申请' })
  async processAfterSale(
    @CurrentUser() user: any,
    @Param('id') id: number,
    @Body() dto: ProcessAfterSaleDto,
  ) {
    const result = await this.afterSaleService.processAfterSale(user.userId, id, dto);
    return CommonResponseDto.success(result);
  }
}
