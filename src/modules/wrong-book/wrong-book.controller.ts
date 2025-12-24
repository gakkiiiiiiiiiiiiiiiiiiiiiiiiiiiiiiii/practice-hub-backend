import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WrongBookService } from './wrong-book.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { RemoveWrongQuestionDto } from './dto/remove-wrong-question.dto';

@ApiTags('错题本')
@Controller('app/wrong_book')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WrongBookController {
  constructor(private readonly wrongBookService: WrongBookService) {}

  @Get()
  @ApiOperation({ summary: '获取错题列表' })
  async getWrongBookList(
    @CurrentUser() user: any,
    @Query('course_id') courseId?: number,
  ) {
    const result = await this.wrongBookService.getWrongBookList(
      user.userId,
      courseId ? +courseId : undefined,
    );
    return CommonResponseDto.success(result);
  }

  @Post('remove')
  @ApiOperation({ summary: '斩题（移除错题）' })
  async removeWrongQuestion(@CurrentUser() user: any, @Body() dto: RemoveWrongQuestionDto) {
    const result = await this.wrongBookService.removeWrongQuestion(user.userId, dto.id);
    return CommonResponseDto.success(result);
  }
}

