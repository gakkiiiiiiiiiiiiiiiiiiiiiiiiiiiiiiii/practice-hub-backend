import { Controller, Post, Body, UseGuards, Get, Query, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NoteService } from './note.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommonResponseDto } from '../../common/dto/common-response.dto';
import { CreateOrUpdateNoteDto } from './dto/create-or-update-note.dto';

@ApiTags('笔记')
@Controller('app/note')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Post('create-or-update')
  @ApiOperation({ summary: '创建或更新笔记' })
  async createOrUpdateNote(@CurrentUser() user: any, @Body() dto: CreateOrUpdateNoteDto) {
    const result = await this.noteService.createOrUpdateNote(user.userId, dto);
    return CommonResponseDto.success(result);
  }

  @Get('list')
  @ApiOperation({ summary: '获取笔记列表' })
  async getNoteList(@CurrentUser() user: any, @Query('question_ids') questionIds?: string) {
    const questionIdArray = questionIds
      ? questionIds.split(',').map((id) => parseInt(id.trim())).filter((id) => !isNaN(id))
      : undefined;
    const result = await this.noteService.getNoteList(user.userId, questionIdArray);
    return CommonResponseDto.success(result);
  }

  @Get('by-question/:questionId')
  @ApiOperation({ summary: '根据题目ID获取笔记' })
  async getNoteByQuestionId(@CurrentUser() user: any, @Param('questionId') questionId: number) {
    const result = await this.noteService.getNoteByQuestionId(user.userId, questionId);
    return CommonResponseDto.success(result);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除笔记' })
  async deleteNote(@CurrentUser() user: any, @Param('id') id: number) {
    const result = await this.noteService.deleteNote(user.userId, id);
    return CommonResponseDto.success(result);
  }
}
