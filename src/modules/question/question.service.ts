import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(QuestionService.name);
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
  /**
   * 带重试的数据库查询
   */
  private async queryWithRetry<T>(
    queryFn: () => Promise<T>,
    retries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await queryFn();
      } catch (error: any) {
        const isConnectionError = 
          error?.code === 'ECONNRESET' || 
          error?.code === 'ECONNREFUSED' ||
          error?.code === 'ETIMEDOUT' ||
          error?.message?.includes('ECONNRESET') ||
          error?.message?.includes('Connection lost');

        if (isConnectionError && i < retries - 1) {
          this.logger.warn(`数据库连接错误，重试中 (${i + 1}/${retries}): ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('查询失败：已达到最大重试次数');
  }

  async getChapterQuestions(chapterId: number, userId?: number) {
    try {
      this.logger.debug(`开始获取章节题目 - 章节ID: ${chapterId}, 用户ID: ${userId || '未登录'}`);

      const chapter = await this.queryWithRetry(() =>
        this.chapterRepository.findOne({
          where: { id: chapterId },
          relations: ['course'],
        })
      );

      if (!chapter) {
        this.logger.warn(`章节不存在 - 章节ID: ${chapterId}`);
        throw new NotFoundException('章节不存在');
      }

      this.logger.debug(`找到章节 - ID: ${chapterId}, 名称: ${chapter.name}, 课程ID: ${chapter.course_id}`);

      const course = chapter.course;

      // 如果课程不存在，抛出异常
      if (!course) {
        this.logger.error(`章节关联的课程不存在 - 章节ID: ${chapterId}, 课程ID: ${chapter.course_id}`);
        throw new NotFoundException('章节关联的课程不存在');
      }

      this.logger.debug(`找到课程 - ID: ${course.id}, 名称: ${course.name}, 价格: ${course.price}, VIP免费: ${course.is_vip_free}`);

      // 判断是否免费：章节免费 或 课程免费/VIP免费
      const isFree = chapter.is_free === 1 || Number(course.price) === 0 || course.is_vip_free === 1;
      this.logger.debug(`权限判断 - 章节免费: ${chapter.is_free === 1}, 课程免费: ${Number(course.price) === 0}, VIP免费: ${course.is_vip_free === 1}, 最终结果: ${isFree}`);

      const questions = await this.queryWithRetry(() =>
        this.questionRepository.find({
          where: { chapter_id: chapterId },
          order: { id: 'ASC' },
        })
      );

      this.logger.debug(`找到题目数量: ${questions.length}`);

      // 检查用户权限和答题状态
      let hasPermission = false;
      const answeredQuestionIds = new Set<number>();

      // 如果是免费的，直接有权限
      if (isFree) {
        hasPermission = true;
        this.logger.debug(`免费内容，用户有权限`);
      } else if (userId) {
        // 如果是付费的，需要检查用户权限
        try {
          await this.checkQuestionPermission(userId, chapterId);
          hasPermission = true;
          this.logger.debug(`用户有权限 - 用户ID: ${userId}`);
        } catch (error) {
          hasPermission = false;
          this.logger.debug(`用户无权限 - 用户ID: ${userId}, 错误: ${error.message}`);
        }
      } else {
        this.logger.debug(`付费内容且用户未登录，无权限`);
      }

      // 获取已作答的题目ID（用于判断是否返回答案和解析）
      if (userId && questions.length > 0) {
        const questionIds = questions.map((q) => q.id);
        const answerLogs = await this.queryWithRetry(() =>
          this.answerLogRepository.find({
            where: {
              user_id: userId,
              question_id: In(questionIds),
            },
            select: ['question_id'], // 只查询题目ID，提高性能
          })
        );
        
        answerLogs.forEach((log) => {
          answeredQuestionIds.add(log.question_id);
        });
        this.logger.debug(`用户已作答题目数量: ${answeredQuestionIds.size}`);
      }

      const result = questions.map((q) => {
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

      this.logger.log(`成功获取章节题目列表 - 章节ID: ${chapterId}, 题目数量: ${result.length}, 有权限: ${hasPermission}`);
      
      return result;
    } catch (error) {
      this.logger.error(`获取章节题目失败 - 章节ID: ${chapterId}, 用户ID: ${userId || '未登录'}`, {
        error: error.message,
        stack: error.stack,
        chapterId,
        userId,
      });
      throw error;
    }
  }

  /**
   * 获取用户答题记录
   * @param userId 用户ID
   * @param chapterId 章节ID（可选）
   * @param questionIds 题目ID列表（可选）
   */
  async getAnswerRecords(userId: number, chapterId?: number, questionIds?: number[]) {
    this.logger.log('=== QuestionService.getAnswerRecords 开始 ===');
    this.logger.log('输入参数:', {
      userId,
      chapterId,
      questionIds,
      userIdType: typeof userId,
      chapterIdType: typeof chapterId,
      questionIdsType: typeof questionIds,
      questionIdsIsArray: Array.isArray(questionIds),
    });

    try {
      // 参数验证
      if (!userId || typeof userId !== 'number') {
        this.logger.error('❌ 参数验证失败 - userId 无效', { userId, userIdType: typeof userId });
        throw new BadRequestException('用户ID无效');
      }

      this.logger.log('✅ 参数验证通过');

      const where: any = {
        user_id: userId,
      };

      this.logger.log('构建查询条件 - 初始 where:', JSON.stringify(where));

      // 如果指定了题目ID列表，添加条件
      if (questionIds && Array.isArray(questionIds) && questionIds.length > 0) {
        // 验证 questionIds 都是有效数字
        const validQuestionIds = questionIds.filter(id => {
          const numId = typeof id === 'number' ? id : Number(id);
          return !isNaN(numId) && numId > 0 && Number.isInteger(numId);
        }).map(id => typeof id === 'number' ? id : Number(id));
        
        if (validQuestionIds.length === 0) {
          this.logger.warn('题目ID列表无效，跳过题目ID过滤', { questionIds, validQuestionIds });
        } else {
          this.logger.log(`使用题目ID列表查询 - 题目数量: ${validQuestionIds.length}`, { questionIds: validQuestionIds });
          where.question_id = In(validQuestionIds);
        }
      }
      
      // 如果指定了章节ID，添加条件
      if (chapterId !== undefined && chapterId !== null) {
        // 严格验证 chapterId 是有效数字
        let numChapterId: number;
        
        // 首先检查是否是 NaN
        if (typeof chapterId === 'number' && isNaN(chapterId)) {
          this.logger.error('❌ 章节ID是NaN', { chapterId });
          throw new BadRequestException('章节ID无效: NaN');
        }
        
        if (typeof chapterId === 'number') {
          numChapterId = chapterId;
        } else if (typeof chapterId === 'string') {
          const strChapterId = chapterId as string;
          numChapterId = parseInt(strChapterId.trim(), 10);
        } else {
          this.logger.error('❌ 章节ID类型不支持', { chapterId, type: typeof chapterId });
          throw new BadRequestException(`章节ID类型无效: ${typeof chapterId}`);
        }
        
        this.logger.log(`章节ID转换 - 原始值: ${chapterId}, 类型: ${typeof chapterId}, 转换后: ${numChapterId}, 是否NaN: ${isNaN(numChapterId)}`);
        
        // 严格验证：必须是有效数字、大于0、整数
        if (isNaN(numChapterId) || !Number.isFinite(numChapterId) || numChapterId <= 0 || !Number.isInteger(numChapterId)) {
          this.logger.error('❌ 章节ID无效', { 
            chapterId, 
            numChapterId, 
            chapterIdType: typeof chapterId,
            isNaN: isNaN(numChapterId),
            isFinite: Number.isFinite(numChapterId),
            isPositive: numChapterId > 0,
            isInteger: Number.isInteger(numChapterId),
          });
          throw new BadRequestException(`章节ID无效: ${chapterId}`);
        }
        
        // 再次确认值有效（防御性编程）
        if (isNaN(numChapterId) || numChapterId <= 0) {
          this.logger.error('❌ 章节ID验证失败（二次检查）', { numChapterId });
          throw new BadRequestException(`章节ID无效: ${numChapterId}`);
        }
        
        this.logger.log(`✅ 使用章节ID查询 - 章节ID: ${numChapterId} (类型: ${typeof numChapterId}, 值: ${numChapterId})`);
        // 如果指定了章节ID，先获取章节下的所有题目ID
        try {
          // 最后一次验证，确保传递给数据库的值是有效的
          const finalChapterId = Number.isInteger(numChapterId) && numChapterId > 0 ? numChapterId : null;
          if (!finalChapterId) {
            this.logger.error('❌ 章节ID最终验证失败', { numChapterId, finalChapterId });
            throw new BadRequestException(`章节ID无效: ${numChapterId}`);
          }
          
          this.logger.log(`查询章节下的题目 - chapter_id: ${finalChapterId} (类型: ${typeof finalChapterId})`);
          const questions = await this.queryWithRetry(() =>
            this.questionRepository.find({
              where: { chapter_id: finalChapterId },
              select: ['id'],
            })
          );
          this.logger.log(`✅ 章节下题目查询完成 - 题目数量: ${questions.length}`);
          
          const chapterQuestionIds = questions.map((q) => q.id).filter(id => id > 0 && Number.isInteger(id));
          if (chapterQuestionIds.length > 0) {
            this.logger.log(`使用章节题目ID列表 - 题目数量: ${chapterQuestionIds.length}`, { chapterQuestionIds });
            // 如果已经有 question_id 条件，使用 AND 逻辑（取交集）
            if (where.question_id) {
              const existingIds = Array.isArray(where.question_id.value) 
                ? where.question_id.value 
                : [where.question_id.value];
              const intersection = existingIds.filter(id => chapterQuestionIds.includes(id));
              if (intersection.length > 0) {
                where.question_id = In(intersection);
              } else {
                // 没有交集，返回空数组
                this.logger.log('题目ID列表与章节题目无交集，返回空数组');
                return [];
              }
            } else {
              where.question_id = In(chapterQuestionIds);
            }
          } else {
            // 章节下没有题目，返回空数组
            this.logger.log('章节下没有题目，返回空数组');
            return [];
          }
        } catch (error) {
          this.logger.error('❌ 查询章节题目失败', {
            error: error.message,
            stack: error.stack,
            chapterId: numChapterId,
            chapterIdType: typeof numChapterId,
            whereCondition: { chapter_id: numChapterId },
          });
          throw error;
        }
      }
      
      // 如果既没有题目ID也没有章节ID，查询所有答题记录
      if (!where.question_id) {
        this.logger.log('查询所有答题记录（无过滤条件）');
      }

      this.logger.log('最终查询条件:', JSON.stringify(where));

      // 查询答题记录，按时间倒序（最新的在前）
      this.logger.log('开始查询答题记录...');
      const answerLogs = await this.queryWithRetry(() =>
        this.answerLogRepository.find({
          where,
          order: { create_time: 'DESC' },
        })
      );

      this.logger.log(`✅ 查询完成 - 答题记录数量: ${answerLogs.length}`);
      if (answerLogs.length > 0) {
        this.logger.log('第一条记录示例:', {
          id: answerLogs[0].id,
          question_id: answerLogs[0].question_id,
          user_option: answerLogs[0].user_option,
          user_option_type: typeof answerLogs[0].user_option,
          is_correct: answerLogs[0].is_correct,
          is_correct_type: typeof answerLogs[0].is_correct,
        });
      }

      // 对每个题目只保留最新的答题记录
      this.logger.log('开始处理答题记录映射...');
      const recordMap = new Map<number, UserAnswerLog>();
      answerLogs.forEach((log, index) => {
        if (!recordMap.has(log.question_id)) {
          recordMap.set(log.question_id, log);
        }
        if (index < 3) {
          this.logger.debug(`处理记录 ${index + 1}:`, {
            question_id: log.question_id,
            user_option: log.user_option,
            is_correct: log.is_correct,
          });
        }
      });

      this.logger.log(`✅ 记录映射完成 - 去重后数量: ${recordMap.size}`);

      // 转换为返回格式
      this.logger.log('开始转换返回格式...');
      const result = Array.from(recordMap.values()).map((log, index) => {
        try {
          // 处理 user_option，确保是数组格式
          let userOption = log.user_option;
          if (typeof userOption === 'string') {
            try {
              userOption = JSON.parse(userOption);
              this.logger.debug(`解析 user_option 成功 - question_id: ${log.question_id}`);
            } catch (e) {
              this.logger.warn(`解析 user_option 失败 - question_id: ${log.question_id}`, {
                userOption,
                error: e.message,
              });
              userOption = [];
            }
          }
          if (!Array.isArray(userOption)) {
            this.logger.warn(`user_option 不是数组 - question_id: ${log.question_id}`, {
              userOption,
              userOptionType: typeof userOption,
            });
            userOption = [];
          }

          const record = {
            question_id: log.question_id,
            user_option: userOption,
            text_answer: log.text_answer || null,
            image_answer: log.image_answer || null,
            is_correct: log.is_correct === null ? null : log.is_correct === 1, // 0-错误, 1-正确, null-待批改
            create_time: log.create_time,
          };

          if (index < 3) {
            this.logger.debug(`转换记录 ${index + 1}:`, record);
          }

          return record;
        } catch (error) {
          this.logger.error(`处理答题记录失败 - question_id: ${log.question_id}`, {
            error: error.message,
            stack: error.stack,
            log: {
              id: log.id,
              question_id: log.question_id,
              user_option: log.user_option,
              user_option_type: typeof log.user_option,
            },
          });
          // 返回一个安全的默认值
          return {
            question_id: log.question_id,
            user_option: [],
            text_answer: null,
            image_answer: null,
            is_correct: null,
            create_time: log.create_time,
          };
        }
      });

      this.logger.log(`✅ 格式转换完成 - 最终记录数量: ${result.length}`);
      this.logger.log('=== QuestionService.getAnswerRecords 完成 ===');

      return result;
    } catch (error) {
      this.logger.error('❌ QuestionService.getAnswerRecords 失败', {
        error: {
          message: error.message,
          name: error.name,
          code: error.code,
          stack: error.stack,
        },
        userId,
        chapterId,
        questionIds,
      });
      this.logger.error('=== QuestionService.getAnswerRecords 异常结束 ===');
      throw error;
    }
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

