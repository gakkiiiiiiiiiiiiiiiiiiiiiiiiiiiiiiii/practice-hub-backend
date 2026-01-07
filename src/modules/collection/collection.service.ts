import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserCollection } from '../../database/entities/user-collection.entity';
import { Question } from '../../database/entities/question.entity';
import { Course } from '../../database/entities/course.entity';

@Injectable()
export class CollectionService {
  constructor(
    @InjectRepository(UserCollection)
    private collectionRepository: Repository<UserCollection>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  /**
   * 收藏/取消收藏
   */
  async toggleCollection(userId: number, questionId: number) {
    const existing = await this.collectionRepository.findOne({
      where: { user_id: userId, question_id: questionId },
    });

    if (existing) {
      // 取消收藏
      await this.collectionRepository.remove(existing);
      return { is_collected: false };
    } else {
      // 添加收藏
      const collection = this.collectionRepository.create({
        user_id: userId,
        question_id: questionId,
      });
      await this.collectionRepository.save(collection);
      return { is_collected: true };
    }
  }

  /**
   * 获取收藏列表
   */
  async getCollectionList(userId: number, questionIds?: number[]) {
    const queryBuilder = this.collectionRepository
      .createQueryBuilder('collection')
      .where('collection.user_id = :userId', { userId })
      .orderBy('collection.create_time', 'DESC');

    if (questionIds && questionIds.length > 0) {
      queryBuilder.andWhere('collection.question_id IN (:...questionIds)', { questionIds });
    }

    const collections = await queryBuilder.getMany();

    // 获取题目详情（包含 chapter 和 course 信息）
    const questionIdsList = collections.map((c) => c.question_id);
    const questions = questionIdsList.length > 0
      ? await this.questionRepository.find({
          where: { id: In(questionIdsList) },
          relations: ['chapter', 'chapter.course'],
        })
      : [];

    // 获取所有相关课程，用于查找课程名称
    const courseIds = [...new Set(questions.map(q => q.chapter?.course_id).filter(id => id))];
    const courses = courseIds.length > 0
      ? await this.courseRepository.find({ where: { id: In(courseIds) } })
      : [];
    const courseMap = new Map(courses.map(c => [c.id, c.name]));

    return collections.map((c) => {
      const question = questions.find((q) => q.id === c.question_id);
      const courseId = question?.chapter?.course_id || null;
      return {
        id: c.id,
        question_id: c.question_id,
        create_time: c.create_time,
        course_id: courseId,
        course_name: courseId ? (courseMap.get(courseId) || '') : '',
        question: question
          ? {
              id: question.id,
              type: question.type,
              stem: question.stem,
              options: question.options,
              answer: question.answer,
              analysis: question.analysis,
              course_id: courseId,
            }
          : null,
      };
    });
  }
}

