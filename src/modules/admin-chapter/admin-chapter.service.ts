import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Chapter } from '../../database/entities/chapter.entity';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { BatchDeleteChaptersDto } from './dto/batch-delete-chapters.dto';
import { BatchUpdateStatusDto } from './dto/batch-update-status.dto';

@Injectable()
export class AdminChapterService {
  constructor(
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
  ) {}

  /**
   * 新增/编辑章节
   */
  async saveChapter(dto: CreateChapterDto | UpdateChapterDto, id?: number) {
    if (id) {
      const chapter = await this.chapterRepository.findOne({ where: { id } });
      if (!chapter) {
        throw new NotFoundException('章节不存在');
      }
      Object.assign(chapter, dto);
      return await this.chapterRepository.save(chapter);
    } else {
      const chapter = this.chapterRepository.create(dto);
      return await this.chapterRepository.save(chapter);
    }
  }

  /**
   * 获取章节列表
   */
  async getChapterList(courseId?: number) {
    const queryBuilder = this.chapterRepository.createQueryBuilder('chapter');

    if (courseId) {
      queryBuilder.where('chapter.course_id = :courseId', { courseId });
    }

    return await queryBuilder.orderBy('chapter.sort', 'ASC').getMany();
  }

  /**
   * 删除章节
   */
  async deleteChapter(id: number) {
    const chapter = await this.chapterRepository.findOne({ where: { id } });
    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }
    return await this.chapterRepository.remove(chapter);
  }

  /**
   * 批量删除章节
   */
  async batchDeleteChapters(dto: BatchDeleteChaptersDto) {
    if (!dto.ids || dto.ids.length === 0) {
      throw new Error('章节ID列表不能为空');
    }

    const chapters = await this.chapterRepository.find({
      where: { id: In(dto.ids) },
    });

    if (chapters.length === 0) {
      throw new NotFoundException('未找到要删除的章节');
    }

    // 批量删除
    await this.chapterRepository.remove(chapters);

    return {
      success: true,
      count: chapters.length,
    };
  }

  /**
   * 批量更新章节状态
   */
  async batchUpdateStatus(dto: BatchUpdateStatusDto) {
    if (!dto.ids || dto.ids.length === 0) {
      throw new Error('章节ID列表不能为空');
    }

    const chapters = await this.chapterRepository.find({
      where: { id: In(dto.ids) },
    });

    if (chapters.length === 0) {
      throw new NotFoundException('未找到要更新的章节');
    }

    // 批量更新状态
    await this.chapterRepository.update(
      { id: In(dto.ids) },
      { status: dto.status },
    );

    return {
      success: true,
      count: chapters.length,
      status: dto.status,
    };
  }
}

