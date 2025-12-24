import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Question, QuestionType } from '../../database/entities/question.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Course } from '../../database/entities/course.entity';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { UserWrongBook } from '../../database/entities/user-wrong-book.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { BatchSubmitDto } from './dto/batch-submit.dto';

@Injectable()
export class QuestionService {
  constructor(
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(Chapter)
    private chapterRepository: Repository<Chapter>,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(UserAnswerLog)
    private answerLogRepository: Repository<UserAnswerLog>,
    @InjectRepository(UserWrongBook)
    private wrongBookRepository: Repository<UserWrongBook>,
    @InjectRepository(UserCourseAuth)
    private userCourseAuthRepository: Repository<UserCourseAuth>,
    private dataSource: DataSource,
  ) {}

  /**
   * 获取章节下的题目列表
   * @param chapterId 章节ID
   * @param userId 用户ID（可选），如果有权限或已作答，返回答案
   */
  async getChapterQuestions(chapterId: number, userId?: number) {
    const chapter = await this.chapterRepository.findOne({
      where: { id: chapterId },
      relations: ['course'],
    });

    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }

    const course = chapter.course;

    // 判断是否免费：章节免费 或 课程免费/VIP免费
    const isFree = chapter.is_free === 1 || Number(course.price) === 0 || course.is_vip_free === 1;

    const questions = await this.questionRepository.find({
      where: { chapter_id: chapterId },
      order: { id: 'ASC' },
    });

    // 检查用户权限和答题状态
    let hasPermission = false;
    const answeredQuestionIds = new Set<number>();

    // 如果是免费的，直接有权限
    if (isFree) {
      hasPermission = true;
    } else if (userId) {
      // 如果是付费的，需要检查用户权限
      try {
        await this.checkQuestionPermission(userId, chapterId);
        hasPermission = true;
      } catch (error) {
        hasPermission = false;
      }
    }

    // 获取已作答的题目ID
    if (userId && questions.length > 0) {
      const questionIds = questions.map((q) => q.id);
      const answerLogs = await this.answerLogRepository.find({
        where: {
          user_id: userId,
          question_id: In(questionIds),
        },
      });
      answerLogs.forEach((log) => {
        answeredQuestionIds.add(log.question_id);
      });
    }

    return questions.map((q) => {
      const result: any = {
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: q.options,
        parent_id: q.parent_id,
        difficulty: q.difficulty,
      };

      // 如果是免费的，或者有权限，或者已作答，返回答案和解析
      if (isFree || hasPermission || answeredQuestionIds.has(q.id)) {
        result.answer = q.answer;
        result.analysis = q.analysis;
      }

      return result;
    });
  }

  /**
   * 获取单题详情（需权限校验）
   */
  async getQuestionDetail(questionId: number, userId?: number) {
    const question = await this.questionRepository.findOne({ where: { id: questionId } });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    // 获取章节信息
    const chapter = await this.chapterRepository.findOne({
      where: { id: question.chapter_id },
    });

    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }

    // 权限校验（如果已登录）
    if (userId) {
      try {
        await this.checkQuestionPermission(userId, question.chapter_id);
      } catch (error) {
        // 权限不足时，不返回答案和解析
        // 继续执行，但不会返回 answer 和 analysis
      }
    }

    // 检查是否已作答
    let hasAnswered = false;
    let hasPermission = false;
    
    if (userId) {
      const answerLog = await this.answerLogRepository.findOne({
        where: { user_id: userId, question_id: questionId },
      });
      hasAnswered = !!answerLog;
      
      // 检查权限
      try {
        await this.checkQuestionPermission(userId, question.chapter_id);
        hasPermission = true;
      } catch (error) {
        hasPermission = false;
      }
    }

    const result: any = {
      id: question.id,
      chapter_id: question.chapter_id,
      parent_id: question.parent_id,
      type: question.type,
      stem: question.stem,
      options: question.options,
      difficulty: question.difficulty,
    };

    // 如果有权限或已作答，返回答案和解析
    if (hasPermission || hasAnswered) {
      result.answer = question.answer;
      result.analysis = question.analysis;
    }

    return result;
  }

  /**
   * 检查题目权限
   */
  private async checkQuestionPermission(userId: number, chapterId: number) {
    const chapter = await this.chapterRepository.findOne({
      where: { id: chapterId },
      relations: ['course'],
    });

    if (!chapter) {
      throw new NotFoundException('章节不存在');
    }

    const course = chapter.course;

    // 免费或VIP免费，直接放行
    if (Number(course.price) === 0 || course.is_vip_free === 1) {
      return;
    }

    // 检查用户权限
    const auth = await this.userCourseAuthRepository.findOne({
      where: {
        user_id: userId,
        course_id: course.id,
      },
    });

    if (!auth) {
      throw new ForbiddenException('请先购买课程或使用激活码');
    }

    // 检查是否过期
    if (auth.expire_time && auth.expire_time <= new Date()) {
      throw new ForbiddenException('课程权限已过期，请重新购买');
    }
  }

  /**
   * 提交答案
   */
  async submitAnswer(userId: number, dto: SubmitAnswerDto) {
    const question = await this.questionRepository.findOne({ where: { id: dto.qid } });

    if (!question) {
      throw new NotFoundException('题目不存在');
    }

    // 权限校验
    await this.checkQuestionPermission(userId, question.chapter_id);

    // 简答题特殊处理：不需要自动判断对错，需要人工批改
    if (question.type === QuestionType.SHORT_ANSWER) {
      // 验证答案格式
      if (!dto.text_answer && !dto.image_answer) {
        throw new BadRequestException('简答题答案不能为空，请填写文本答案或上传图片');
      }

      // 记录答题日志（简答题不自动判断对错）
      await this.answerLogRepository.save({
        user_id: userId,
        question_id: dto.qid,
        user_option: [],
        text_answer: dto.text_answer || null,
        image_answer: dto.image_answer || null,
        is_correct: null, // null 表示待批改
      });

      return {
        is_correct: null, // 待批改
        answer: question.answer,
        analysis: question.analysis,
        message: '答案已提交，等待批改',
      };
    }

    // 其他题型的答案验证
    if (!dto.options || dto.options.length === 0) {
      throw new BadRequestException('答案不能为空');
    }

    // 判断正误
    const correctAnswer = question.answer || [];
    const userAnswer = dto.options || [];
    
    let isCorrect = false;
    
    // 填空题特殊处理：支持任意个答案，只要用户答案包含所有正确答案即可
    if (question.type === QuestionType.FILL_BLANK) {
      // 填空题：去除空格后比较，支持不区分大小写
      const normalizedCorrect = correctAnswer.map(ans => String(ans).trim().toLowerCase());
      const normalizedUser = userAnswer.map(ans => String(ans).trim().toLowerCase());
      
      // 检查用户答案是否包含所有正确答案（允许用户答案更多）
      isCorrect = normalizedCorrect.length > 0 && 
        normalizedCorrect.every(correct => normalizedUser.includes(correct));
    } else {
      // 其他题型：严格匹配
      isCorrect =
        correctAnswer.length === userAnswer.length &&
        correctAnswer.every((ans) => userAnswer.includes(ans));
    }

    // 记录答题日志
    await this.answerLogRepository.save({
      user_id: userId,
      question_id: dto.qid,
      user_option: userAnswer,
      text_answer: null,
      image_answer: null,
      is_correct: isCorrect ? 1 : 0,
    });

    // 更新错题本
    if (!isCorrect) {
      await this.updateWrongBook(userId, question);
    }

    return {
      is_correct: isCorrect,
      answer: question.answer,
      analysis: question.analysis,
    };
  }

  /**
   * 批量提交（试卷模式）
   */
  async batchSubmit(userId: number, dto: BatchSubmitDto) {
    const results = [];
    let correctCount = 0;
    const wrongQuestions = [];

    for (const item of dto.answers) {
      const question = await this.questionRepository.findOne({ where: { id: item.qid } });

      if (!question) {
        continue;
      }

      // 权限校验
      try {
        await this.checkQuestionPermission(userId, question.chapter_id);
      } catch (error) {
        continue;
      }

      // 简答题特殊处理：不需要自动判断对错
      if (question.type === QuestionType.SHORT_ANSWER) {
        // 简答题：记录答案，不判断对错
        await this.answerLogRepository.save({
          user_id: userId,
          question_id: item.qid,
          user_option: [],
          text_answer: (item as any).text_answer || null,
          image_answer: (item as any).image_answer || null,
          is_correct: null, // null 表示待批改
        });

        results.push({
          qid: item.qid,
          is_correct: null, // 待批改
        });
        continue;
      }

      // 其他题型的答案验证
      if (!item.options || item.options.length === 0) {
        results.push({
          qid: item.qid,
          is_correct: false,
          error: '答案不能为空',
        });
        continue;
      }

      // 判断正误
      const correctAnswer = question.answer || [];
      const userAnswer = item.options || [];
      
      let isCorrect = false;
      
      // 填空题特殊处理：支持任意个答案，只要用户答案包含所有正确答案即可
      if (question.type === QuestionType.FILL_BLANK) {
        // 填空题：去除空格后比较，支持不区分大小写
        const normalizedCorrect = correctAnswer.map(ans => String(ans).trim().toLowerCase());
        const normalizedUser = userAnswer.map(ans => String(ans).trim().toLowerCase());
        
        // 检查用户答案是否包含所有正确答案（允许用户答案更多）
        isCorrect = normalizedCorrect.length > 0 && 
          normalizedCorrect.every(correct => normalizedUser.includes(correct));
      } else {
        // 其他题型：严格匹配
        isCorrect =
          correctAnswer.length === userAnswer.length &&
          correctAnswer.every((ans) => userAnswer.includes(ans));
      }

      if (isCorrect) {
        correctCount++;
      } else {
        wrongQuestions.push({
          qid: item.qid,
          correct_answer: correctAnswer,
        });
        await this.updateWrongBook(userId, question);
      }

      // 记录答题日志
      await this.answerLogRepository.save({
        user_id: userId,
        question_id: item.qid,
        user_option: userAnswer,
        text_answer: null,
        image_answer: null,
        is_correct: isCorrect ? 1 : 0,
      });

      results.push({
        qid: item.qid,
        is_correct: isCorrect,
      });
    }

    const total = dto.answers.length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    return {
      score,
      total,
      correct_count: correctCount,
      wrong_questions: wrongQuestions,
    };
  }

  /**
   * 更新错题本
   */
  private async updateWrongBook(userId: number, question: Question) {
    const chapter = await this.chapterRepository.findOne({
      where: { id: question.chapter_id },
    });

    if (!chapter) {
      return;
    }

    let wrongBook = await this.wrongBookRepository.findOne({
      where: {
        user_id: userId,
        question_id: question.id,
      },
    });

    if (wrongBook) {
      wrongBook.error_count += 1;
      wrongBook.last_error_time = new Date();
      wrongBook.is_mastered = 0; // 重新标记为未斩题
    } else {
      wrongBook = this.wrongBookRepository.create({
        user_id: userId,
        question_id: question.id,
        course_id: chapter.course_id,
        error_count: 1,
        last_error_time: new Date(),
        is_mastered: 0,
      });
    }

    await this.wrongBookRepository.save(wrongBook);
  }
}

