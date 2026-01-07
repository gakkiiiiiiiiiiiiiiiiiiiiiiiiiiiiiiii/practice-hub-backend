import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserWrongBook } from '../../database/entities/user-wrong-book.entity';
import { Question } from '../../database/entities/question.entity';
import { Course } from '../../database/entities/course.entity';

@Injectable()
export class WrongBookService {
  constructor(
    @InjectRepository(UserWrongBook)
    private wrongBookRepository: Repository<UserWrongBook>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  /**
   * 获取错题列表
   */
  async getWrongBookList(userId: number, courseId?: number) {
    const queryBuilder = this.wrongBookRepository
      .createQueryBuilder('wrong')
      .where('wrong.user_id = :userId', { userId })
      .andWhere('wrong.is_mastered = 0');

    if (courseId) {
      queryBuilder.andWhere('wrong.course_id = :courseId', { courseId });
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

    // 获取课程信息
    const courseIds = [...new Set(wrongBooks.map((wb) => wb.course_id))];
    const courses = courseIds.length > 0
      ? await this.courseRepository.find({
          where: { id: In(courseIds) },
        })
      : [];

    return wrongBooks.map((wb) => {
      const question = questions.find((q) => q.id === wb.question_id);
      const course = courses.find((c) => c.id === wb.course_id);
      return {
        id: wb.id,
        question_id: wb.question_id,
        course_id: wb.course_id,
        course_name: course?.name || '',
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

