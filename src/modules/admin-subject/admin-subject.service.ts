import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject } from '../../database/entities/subject.entity';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@Injectable()
export class AdminSubjectService {
  constructor(
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
  ) {}

  /**
   * 新增/编辑科目
   */
  async saveSubject(dto: CreateSubjectDto | UpdateSubjectDto, id?: number) {
    if (id) {
      const subject = await this.subjectRepository.findOne({ where: { id } });
      if (!subject) {
        throw new NotFoundException('科目不存在');
      }
      Object.assign(subject, dto);
      return await this.subjectRepository.save(subject);
    } else {
      const subject = this.subjectRepository.create(dto);
      return await this.subjectRepository.save(subject);
    }
  }

  /**
   * 获取科目列表
   */
  async getSubjectList() {
    return await this.subjectRepository.find({
      order: { sort: 'ASC' },
    });
  }
}

