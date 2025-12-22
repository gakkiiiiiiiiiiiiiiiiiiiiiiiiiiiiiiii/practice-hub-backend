import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject } from '../../database/entities/subject.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { UserSubjectAuth } from '../../database/entities/user-subject-auth.entity';

@Injectable()
export class SubjectService {
  constructor(
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(UserSubjectAuth)
    private userSubjectAuthRepository: Repository<UserSubjectAuth>,
  ) {}

  /**
   * 获取所有题库列表
   */
  async getAllSubjects(keyword?: string) {
    const queryBuilder = this.subjectRepository.createQueryBuilder('subject');

    if (keyword) {
      queryBuilder.where('subject.name LIKE :keyword', { keyword: `%${keyword}%` });
    }

    const subjects = await queryBuilder.orderBy('subject.sort', 'ASC').getMany();

    return subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      cover_img: subject.cover_img,
      price: subject.price,
      is_vip_free: subject.is_vip_free,
      student_count: subject.student_count,
    }));
  }

  /**
   * 获取题库详情（包含章节列表和用户权限）
   */
  async getSubjectDetail(subjectId: number, userId?: number): Promise<any> {
    const subject = await this.subjectRepository.findOne({ where: { id: subjectId } });

    if (!subject) {
      throw new NotFoundException('题库不存在');
    }

    // 获取章节列表
    const chapters = await this.chapterRepository.find({
      where: { subject_id: subjectId },
      order: { sort: 'ASC' },
    });

    // 检查用户权限
    let hasAuth = false;
    if (userId) {
      // 检查是否免费或VIP免费
      if (subject.price === 0 || subject.is_vip_free === 1) {
        hasAuth = true;
      } else {
        // 检查是否已购买
        const auth = await this.userSubjectAuthRepository.findOne({
          where: {
            user_id: userId,
            subject_id: subjectId,
          },
        });

        if (auth) {
          // 检查是否过期
          if (!auth.expire_time || auth.expire_time > new Date()) {
            hasAuth = true;
          }
        }
      }
    }

    return {
      id: subject.id,
      name: subject.name,
      cover_img: subject.cover_img,
      price: subject.price,
      is_vip_free: subject.is_vip_free,
      student_count: subject.student_count,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        name: chapter.name,
        type: chapter.type,
        is_free: chapter.is_free,
        sort: chapter.sort,
      })),
      hasAuth,
    };
  }
}

