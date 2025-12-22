import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserWrongBook } from '../../database/entities/user-wrong-book.entity';
import { Question } from '../../database/entities/question.entity';

@Injectable()
export class WrongBookService {
  constructor(
    @InjectRepository(UserWrongBook)
    private wrongBookRepository: Repository<UserWrongBook>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
  ) {}

  /**
   * 获取错题列表
   */
  async getWrongBookList(userId: number, subjectId?: number) {
    const queryBuilder = this.wrongBookRepository
      .createQueryBuilder('wrong')
      .where('wrong.user_id = :userId', { userId })
      .andWhere('wrong.is_mastered = 0');

    if (subjectId) {
      queryBuilder.andWhere('wrong.subject_id = :subjectId', { subjectId });
    }

    const wrongBooks = await queryBuilder
      .orderBy('wrong.last_error_time', 'DESC')
      .getMany();

    // 获取题目详情
    const questionIds = wrongBooks.map((wb) => wb.question_id);
    const questions = questionIds.length > 0
      ? await this.questionRepository.find({
          where: { id: In(questionIds) },
        })
      : [];

    return wrongBooks.map((wb) => {
      const question = questions.find((q) => q.id === wb.question_id);
      return {
        id: wb.id,
        question_id: wb.question_id,
        subject_id: wb.subject_id,
        error_count: wb.error_count,
        last_error_time: wb.last_error_time,
        question: question
          ? {
              id: question.id,
              type: question.type,
              stem: question.stem,
              options: question.options,
              answer: question.answer,
              analysis: question.analysis,
            }
          : null,
      };
    });
  }

  /**
   * 斩题（移除错题）
   */
  async removeWrongQuestion(userId: number, wrongBookId: number) {
    const wrongBook = await this.wrongBookRepository.findOne({
      where: { id: wrongBookId, user_id: userId },
    });

    if (!wrongBook) {
      throw new Error('错题记录不存在');
    }

    wrongBook.is_mastered = 1;
    await this.wrongBookRepository.save(wrongBook);

    return { success: true };
  }
}

