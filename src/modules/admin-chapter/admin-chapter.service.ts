import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chapter } from '../../database/entities/chapter.entity';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';

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
}

