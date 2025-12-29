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
		private dataSource: DataSource
	) {}

	/**
	 * 获取章节下的题目列表
	 * @param chapterId 章节ID
	 * @param userId 用户ID（可选），如果有权限或已作答，返回答案
	 */
	/**
	 * 带重试的数据库查询
	 */
	private async queryWithRetry<T>(queryFn: () => Promise<T>, retries: number = 3, delay: number = 1000): Promise<T> {
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
					await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
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

			this.logger.debug(
				`找到课程 - ID: ${course.id}, 名称: ${course.name}, 价格: ${course.price}, VIP免费: ${course.is_vip_free}`
			);

			// 判断是否免费：章节免费 或 课程免费/VIP免费
			const isFree = chapter.is_free === 1 || Number(course.price) === 0 || course.is_vip_free === 1;
			this.logger.debug(
				`权限判断 - 章节免费: ${chapter.is_free === 1}, 课程免费: ${Number(course.price) === 0}, VIP免费: ${course.is_vip_free === 1}, 最终结果: ${isFree}`
			);

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

			this.logger.log(
				`成功获取章节题目列表 - 章节ID: ${chapterId}, 题目数量: ${result.length}, 有权限: ${hasPermission}`
			);

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
		this.logger.log('开始查询答题记录...');
		this.logger.log(
			`Service 接收参数 - userId: ${userId} (${typeof userId}), chapterId: ${chapterId} (${typeof chapterId}), questionIds: ${JSON.stringify(questionIds)}`
		);

		// 1. 基础过滤条件：用户ID必须是有效数字
		if (!Number.isSafeInteger(userId)) {
			this.logger.error(`Invalid userId: ${userId} (${typeof userId})`);
			throw new BadRequestException('Invalid UserID');
		}

		const where: any = { user_id: userId };

		// 2. 处理章节过滤（直接使用 chapter_id 字段查询，如果表中有该字段）
		if (chapterId !== undefined && chapterId !== null) {
			// 检查是否是 NaN
			if (typeof chapterId === 'number' && isNaN(chapterId)) {
				this.logger.error(`chapterId is NaN: ${chapterId}`);
				throw new BadRequestException('Invalid ChapterID: NaN');
			}

			// 强制转换并检查是否为有效正整数
			const targetChapterId = typeof chapterId === 'number' ? chapterId : Number(chapterId);

			this.logger.log(
				`转换后的 chapterId: ${targetChapterId} (${typeof targetChapterId}), isNaN: ${isNaN(targetChapterId)}, isSafeInteger: ${Number.isSafeInteger(targetChapterId)}`
			);

			if (!Number.isSafeInteger(targetChapterId) || targetChapterId <= 0) {
				this.logger.error(`Invalid chapterId: ${targetChapterId} (${typeof targetChapterId})`);
				throw new BadRequestException(`Invalid ChapterID: ${targetChapterId}`);
			}

			// 优先使用 chapter_id 字段直接查询（如果表中有该字段）
			// 如果没有该字段，则通过 question 表关联查询
			this.logger.log(`使用章节ID过滤 - chapter_id: ${targetChapterId}`);
			where.chapter_id = targetChapterId;
		}

		// 3. 处理题目ID列表过滤 (如果有交集)
		if (questionIds && Array.isArray(questionIds) && questionIds.length > 0) {
			const targetIds = questionIds
				.map((id) => {
					const numId = typeof id === 'number' ? id : Number(id);
					return Number.isSafeInteger(numId) && numId > 0 ? numId : null;
				})
				.filter((id): id is number => id !== null);

			if (targetIds.length === 0) {
				this.logger.warn('questionIds 转换后没有有效ID');
			} else {
				if (where.question_id) {
					// 取交集
					const existingInIds = (where.question_id as any).value;
					const intersection = targetIds.filter((id) => existingInIds.includes(id));
					if (intersection.length === 0) {
						return [];
					}
					where.question_id = In(intersection);
				} else {
					where.question_id = In(targetIds);
				}
			}
		}

		// 4. 最终验证 where 对象，确保没有 NaN
		this.logger.log(`最终查询条件: ${JSON.stringify(where)}`);
		const checkWhere = (obj: any, path = ''): void => {
			for (const key in obj) {
				this.logger.log('key:', key, 'value:', obj[key]);
				const value = obj[key];
				const currentPath = path ? `${path}.${key}` : key;
				if (value !== null && value !== undefined) {
					if (typeof value === 'number' && isNaN(value)) {
						this.logger.error(`发现 NaN 在 ${currentPath}: ${value}`);
						throw new BadRequestException(`查询条件包含无效值: ${currentPath}`);
					}
					if (value && typeof value === 'object' && 'value' in value) {
						const inValue = (value as any).value;
						if (Array.isArray(inValue)) {
							inValue.forEach((item: any, index: number) => {
								if (typeof item === 'number' && isNaN(item)) {
									this.logger.error(`发现 NaN 在 ${currentPath}.value[${index}]: ${item}`);
									throw new BadRequestException(`查询条件包含无效值: ${currentPath}.value[${index}]`);
								}
							});
						}
					}
				}
			}
		};
		checkWhere(where);

		// 5. 执行查询
		this.logger.log('执行数据库查询...');
		this.logger.log(`查询条件详情:`, {
			where: JSON.stringify(where),
			whereKeys: Object.keys(where),
			whereValues: Object.values(where),
		});

		let answerLogs: UserAnswerLog[] = [];
		try {
			answerLogs = await this.queryWithRetry(() =>
				this.answerLogRepository.find({
					where,
					order: { create_time: 'DESC' },
				})
			);
			this.logger.log(`✅ 数据库查询成功 - 返回记录数: ${answerLogs.length}`);

			// 如果查询结果为空，记录详细信息用于调试
			if (answerLogs.length === 0) {
				this.logger.warn('⚠️  查询结果为空，可能的原因：');
				this.logger.warn(`  - userId: ${userId}`);
				if (where.chapter_id) {
					this.logger.warn(`  - chapter_id: ${where.chapter_id}`);
				}
				if (where.question_id) {
					const questionIds = (where.question_id as any).value || where.question_id;
					this.logger.warn(`  - question_id: ${JSON.stringify(questionIds)}`);
				}

				// 尝试查询该用户的所有记录，用于对比
				const allUserLogs = await this.queryWithRetry(() =>
					this.answerLogRepository.find({
						where: { user_id: userId },
						select: ['id', 'user_id', 'question_id', 'chapter_id'],
						take: 5, // 只取前5条
					})
				);
				this.logger.log(`该用户总记录数（前5条）: ${allUserLogs.length}`);
				if (allUserLogs.length > 0) {
					this.logger.log('示例记录:', JSON.stringify(allUserLogs[0]));
				}
			}
		} catch (error: any) {
			// 如果是因为 chapter_id 字段不存在而报错，尝试使用关联查询
			if (error.message && error.message.includes('chapter_id')) {
				this.logger.warn('⚠️  chapter_id 字段不存在，尝试使用关联查询...');

				// 回退到原来的逻辑：通过 question 表关联查询
				if (chapterId !== undefined && chapterId !== null) {
					const targetChapterId = typeof chapterId === 'number' ? chapterId : Number(chapterId);
					const questions = await this.queryWithRetry(() =>
						this.questionRepository.find({
							where: { chapter_id: targetChapterId },
							select: ['id'],
						})
					);
					const idsFromChapter = questions.map((q) => q.id).filter((id) => Number.isSafeInteger(id) && id > 0);

					if (idsFromChapter.length === 0) {
						this.logger.warn('章节下没有题目');
						return [];
					}

					// 移除 chapter_id，使用 question_id 过滤
					delete where.chapter_id;
					if (where.question_id) {
						const existingIds = (where.question_id as any).value || [];
						const intersection = idsFromChapter.filter((id) => existingIds.includes(id));
						where.question_id = In(intersection.length > 0 ? intersection : idsFromChapter);
					} else {
						where.question_id = In(idsFromChapter);
					}

					answerLogs = await this.queryWithRetry(() =>
						this.answerLogRepository.find({
							where,
							order: { create_time: 'DESC' },
						})
					);
					this.logger.log(`✅ 关联查询成功 - 返回记录数: ${answerLogs.length}`);
				} else {
					throw error;
				}
			} else {
				throw error;
			}
		}

		// 6. 对每个题目只保留最新的答题记录
		const recordMap = new Map<number, UserAnswerLog>();
		answerLogs.forEach((log) => {
			if (!recordMap.has(log.question_id)) {
				recordMap.set(log.question_id, log);
			}
		});

		// 6. 转换为返回格式
		const result = Array.from(recordMap.values()).map((log) => {
			// 处理 user_option，确保是数组格式
			let userOption = log.user_option;
			if (typeof userOption === 'string') {
				try {
					userOption = JSON.parse(userOption);
				} catch (e) {
					userOption = [];
				}
			}
			if (!Array.isArray(userOption)) {
				userOption = [];
			}

			return {
				question_id: log.question_id,
				user_option: userOption,
				text_answer: log.text_answer || null,
				image_answer: log.image_answer || null,
				is_correct: log.is_correct === null ? null : log.is_correct === 1, // 0-错误, 1-正确, null-待批改
				create_time: log.create_time,
			};
		});

		this.logger.log(`✅ 查询完成 - 记录数量: ${result.length}`);
		return result;
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
				chapter_id: question.chapter_id,
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
			const normalizedCorrect = correctAnswer.map((ans) => String(ans).trim().toLowerCase());
			const normalizedUser = userAnswer.map((ans) => String(ans).trim().toLowerCase());

			// 检查用户答案是否包含所有正确答案（允许用户答案更多）
			isCorrect =
				normalizedCorrect.length > 0 && normalizedCorrect.every((correct) => normalizedUser.includes(correct));
		} else {
			// 其他题型：严格匹配
			isCorrect = correctAnswer.length === userAnswer.length && correctAnswer.every((ans) => userAnswer.includes(ans));
		}

		// 记录答题日志
		await this.answerLogRepository.save({
			user_id: userId,
			question_id: dto.qid,
			chapter_id: question.chapter_id,
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
					chapter_id: question.chapter_id,
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
				const normalizedCorrect = correctAnswer.map((ans) => String(ans).trim().toLowerCase());
				const normalizedUser = userAnswer.map((ans) => String(ans).trim().toLowerCase());

				// 检查用户答案是否包含所有正确答案（允许用户答案更多）
				isCorrect =
					normalizedCorrect.length > 0 && normalizedCorrect.every((correct) => normalizedUser.includes(correct));
			} else {
				// 其他题型：严格匹配
				isCorrect =
					correctAnswer.length === userAnswer.length && correctAnswer.every((ans) => userAnswer.includes(ans));
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
				chapter_id: question.chapter_id,
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
