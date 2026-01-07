import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { ToggleCollectionDto } from './dto/toggle-collection.dto';

@ApiTags('收藏')
@Controller('app/favorite')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Post('toggle')
  @ApiOperation({ summary: '收藏/取消收藏' })
  async toggleCollection(@CurrentUser() user: any, @Body() dto: ToggleCollectionDto) {
    const result = await this.collectionService.toggleCollection(user.userId, dto.question_id);
    return CommonResponseDto.success(result);
  }

  @Get('list')
  @ApiOperation({ summary: '获取收藏列表' })
  async getCollectionList(@CurrentUser() user: any, @Query('question_ids') questionIds?: string) {
    const questionIdArray = questionIds
      ? questionIds.split(',').map((id) => parseInt(id.trim())).filter((id) => !isNaN(id))
      : undefined;
    const result = await this.collectionService.getCollectionList(user.userId, questionIdArray);
    return CommonResponseDto.success(result);
  }
}

