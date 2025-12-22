import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RecommendService } from './recommend.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../database/entities/sys-user.entity';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { OperationLogInterceptor } from '../../common/interceptors/operation-log.interceptor';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemSortDto } from './dto/update-item-sort.dto';

@ApiTags('首页推荐管理')
@Controller('admin/recommend')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OperationLogInterceptor)
@ApiBearerAuth()
@Roles(AdminRole.SUPER_ADMIN)
export class RecommendController {
  constructor(private readonly recommendService: RecommendService) {}

  @Get('categories')
  @ApiOperation({ summary: '获取推荐版块列表' })
  async getCategories() {
    const result = await this.recommendService.getCategories();
    return CommonResponseDto.success(result);
  }

  @Get('categories/:id')
  @ApiOperation({ summary: '获取版块详情（包含题库列表）' })
  async getCategoryDetail(@Param('id') id: number) {
    const result = await this.recommendService.getCategoryDetail(+id);
    return CommonResponseDto.success(result);
  }

  @Post('categories')
  @ApiOperation({ summary: '创建版块' })
  async createCategory(@Body() dto: CreateCategoryDto) {
    const result = await this.recommendService.createCategory(dto);
    return CommonResponseDto.success(result);
  }

  @Put('categories/:id')
  @ApiOperation({ summary: '更新版块信息' })
  async updateCategory(@Param('id') id: number, @Body() dto: UpdateCategoryDto) {
    const result = await this.recommendService.updateCategory(+id, dto);
    return CommonResponseDto.success(result);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: '删除版块' })
  async deleteCategory(@Param('id') id: number) {
    const result = await this.recommendService.deleteCategory(+id);
    return CommonResponseDto.success(result);
  }

  @Post('items')
  @ApiOperation({ summary: '添加题库到版块' })
  async addItem(@Body() dto: AddItemDto) {
    const result = await this.recommendService.addItem(dto);
    return CommonResponseDto.success(result);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '移除版块内的题库' })
  async removeItem(@Param('id') id: number) {
    const result = await this.recommendService.removeItem(+id);
    return CommonResponseDto.success(result);
  }

  @Put('items/sort')
  @ApiOperation({ summary: '调整版块内题库排序' })
  async updateItemSort(@Body() dto: UpdateItemSortDto) {
    const result = await this.recommendService.updateItemSort(dto);
    return CommonResponseDto.success(result);
  }
}

