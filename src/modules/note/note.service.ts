import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserNote } from '../../database/entities/user-note.entity';
import { Question } from '../../database/entities/question.entity';
import { Course } from '../../database/entities/course.entity';
import { CreateOrUpdateNoteDto } from './dto/create-or-update-note.dto';

@Injectable()
export class NoteService {
  constructor(
    @InjectRepository(UserNote)
    private noteRepository: Repository<UserNote>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  /**
   * 创建或更新笔记
   */
  async createOrUpdateNote(userId: number, dto: CreateOrUpdateNoteDto) {
    const existing = await this.noteRepository.findOne({
      where: { user_id: userId, question_id: dto.question_id },
    });

    if (existing) {
      // 更新笔记
      existing.content = dto.content;
      await this.noteRepository.save(existing);
      return existing;
    } else {
      // 创建新笔记
      const note = this.noteRepository.create({
        user_id: userId,
        question_id: dto.question_id,
        content: dto.content,
      });
      return await this.noteRepository.save(note);
    }
  }

  /**
   * 获取笔记列表
   */
  async getNoteList(userId: number, questionIds?: number[]) {
    const queryBuilder = this.noteRepository
      .createQueryBuilder('note')
      .where('note.user_id = :userId', { userId })
      .orderBy('note.update_time', 'DESC');

    if (questionIds && questionIds.length > 0) {
      queryBuilder.andWhere('note.question_id IN (:...questionIds)', { questionIds });
    }

    const notes = await queryBuilder.getMany();

    // 获取题目详情（包含 chapter 和 course 信息）
    const questionIdsList = notes.map((n) => n.question_id);
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

    return notes.map((n) => {
      const question = questions.find((q) => q.id === n.question_id);
      const courseId = question?.chapter?.course_id || null;
      return {
        id: n.id,
        question_id: n.question_id,
        content: n.content,
        create_time: n.create_time,
        update_time: n.update_time,
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

  /**
   * 根据题目ID获取笔记
   */
  async getNoteByQuestionId(userId: number, questionId: number) {
    const note = await this.noteRepository.findOne({
      where: { user_id: userId, question_id: questionId },
    });

    if (!note) {
      return null;
    }

    return note;
  }

  /**
   * 删除笔记
   */
  async deleteNote(userId: number, noteId: number) {
    const note = await this.noteRepository.findOne({
      where: { id: noteId, user_id: userId },
    });

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    await this.noteRepository.remove(note);
    return { success: true };
  }
}
