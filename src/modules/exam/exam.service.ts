import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ExamConfig } from '../../database/entities/exam-config.entity';
import { ExamRecord } from '../../database/entities/exam-record.entity';
import { Question, QuestionType } from '../../database/entities/question.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Course } from '../../database/entities/course.entity';
import { CreateExamConfigDto } from './dto/create-exam-config.dto';
import { StartExamDto } from './dto/start-exam.dto';
import { SubmitExamDto } from './dto/submit-exam.dto';

@Injectable()
export class ExamService {
	private readonly logger = new Logger(ExamService.name);

	constructor(
		@InjectRepository(ExamConfig)
		private examConfigRepository: Repository<ExamConfig>,
		@InjectRepository(ExamRecord)
		private examRecordRepository: Repository<ExamRecord>,
		@InjectRepository(Question)
		private questionRepository: Repository<Question>,
		@InjectRepository(Chapter)
		private chapterRepository: Repository<Chapter>,
		@InjectRepository(Course)
		private courseRepository: Repository<Course>
	) {}

	/**
	 * 创建或更新考试配置
	 */
	async saveExamConfig(dto: CreateExamConfigDto, id?: number) {
		// 验证课程是否存在
		const course = await this.courseRepository.findOne({
			where: { id: dto.course_id },
		});

		if (!course) {
			throw new NotFoundException('课程不存在');
		}

		// 计算题目总数和满分
		const questionCount = dto.single_choice_count + dto.multiple_choice_count + dto.judge_count;
		const fullScore =
			dto.single_choice_count * dto.single_choice_score +
			dto.multiple_choice_count * dto.multiple_choice_score +
			dto.judge_count * dto.judge_score;

		if (id) {
			// 更新
			const config = await this.examConfigRepository.findOne({
				where: { id },
			});

			if (!config) {
				throw new NotFoundException('考试配置不存在');
			}

			Object.assign(config, {
				...dto,
				question_count: questionCount,
				full_score: fullScore,
			});

			await this.examConfigRepository.save(config);
			return config;
		} else {
			// 创建
			const config = this.examConfigRepository.create({
				...dto,
				question_count: questionCount,
				full_score: fullScore,
			});

			await this.examConfigRepository.save(config);
			return config;
		}
	}

	/**
	 * 获取考试配置列表
	 */
	async getExamConfigList(courseId?: number) {
		const where: any = {};
		if (courseId) {
			where.course_id = courseId;
		}

		const configs = await this.examConfigRepository.find({
			where,
			relations: ['course'],
			order: { create_time: 'DESC' },
		});

		return configs.map((config) => ({
			id: config.id,
			course_id: config.course_id,
			course_name: config.course?.name,
			name: config.name,
			question_count: config.question_count,
			duration: config.duration,
			single_choice_score: config.single_choice_score,
			single_choice_count: config.single_choice_count,
			multiple_choice_score: config.multiple_choice_score,
			multiple_choice_count: config.multiple_choice_count,
			judge_score: config.judge_score,
			judge_count: config.judge_count,
			full_score: config.full_score,
			pass_score: config.pass_score,
			rules: config.rules,
			is_enabled: config.is_enabled,
			create_time: config.create_time,
		}));
	}

	/**
	 * 获取考试配置详情
	 */
	async getExamConfig(id: number) {
		const config = await this.examConfigRepository.findOne({
			where: { id },
			relations: ['course'],
		});

		if (!config) {
			throw new NotFoundException('考试配置不存在');
		}

		return {
			id: config.id,
			course_id: config.course_id,
			course_name: config.course?.name,
			name: config.name,
			question_count: config.question_count,
			duration: config.duration,
			single_choice_score: config.single_choice_score,
			single_choice_count: config.single_choice_count,
			multiple_choice_score: config.multiple_choice_score,
			multiple_choice_count: config.multiple_choice_count,
			judge_score: config.judge_score,
			judge_count: config.judge_count,
			full_score: config.full_score,
			pass_score: config.pass_score,
			rules: config.rules,
			is_enabled: config.is_enabled,
		};
	}

	/**
	 * 删除考试配置
	 */
	async deleteExamConfig(id: number) {
		const config = await this.examConfigRepository.findOne({
			where: { id },
		});

		if (!config) {
			throw new NotFoundException('考试配置不存在');
		}

		await this.examConfigRepository.remove(config);
		return { message: '删除成功' };
	}

	/**
	 * 开始考试 - 生成题目
	 */
	async startExam(userId: number, dto: StartExamDto) {
		const config = await this.examConfigRepository.findOne({
			where: { id: dto.exam_config_id },
			relations: ['course'],
		});

		if (!config) {
			throw new NotFoundException('考试配置不存在');
		}

		if (config.is_enabled === 0) {
			throw new BadRequestException('该考试已禁用');
		}

		// 获取课程下的所有章节
		const chapters = await this.chapterRepository.find({
			where: { course_id: config.course_id },
			select: ['id'],
		});

		if (!chapters || chapters.length === 0) {
			throw new BadRequestException('该课程下没有章节');
		}

		const chapterIds = chapters.map((c) => c.id);

		// 获取所有符合条件的题目（只选选择题和判断题）
		const allQuestions = await this.questionRepository.find({
			where: {
				chapter_id: In(chapterIds),
				type: In([QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE, QuestionType.JUDGE]),
				parent_id: 0, // 排除阅读理解子题
			},
		});

		// 按类型分组
		const singleChoiceQuestions = allQuestions.filter((q) => q.type === QuestionType.SINGLE_CHOICE);
		const multipleChoiceQuestions = allQuestions.filter((q) => q.type === QuestionType.MULTIPLE_CHOICE);
		const judgeQuestions = allQuestions.filter((q) => q.type === QuestionType.JUDGE);

		// 检查题目数量是否足够
		if (singleChoiceQuestions.length < config.single_choice_count) {
			throw new BadRequestException(
				`单选题数量不足，需要 ${config.single_choice_count} 道，但只有 ${singleChoiceQuestions.length} 道`
			);
		}
		if (multipleChoiceQuestions.length < config.multiple_choice_count) {
			throw new BadRequestException(
				`多选题数量不足，需要 ${config.multiple_choice_count} 道，但只有 ${multipleChoiceQuestions.length} 道`
			);
		}
		if (judgeQuestions.length < config.judge_count) {
			throw new BadRequestException(
				`判断题数量不足，需要 ${config.judge_count} 道，但只有 ${judgeQuestions.length} 道`
			);
		}

		// 随机抽取题目
		const selectedQuestions: Question[] = [];

		// 抽取单选题
		const shuffledSingle = this.shuffleArray([...singleChoiceQuestions]);
		selectedQuestions.push(...shuffledSingle.slice(0, config.single_choice_count));

		// 抽取多选题
		const shuffledMultiple = this.shuffleArray([...multipleChoiceQuestions]);
		selectedQuestions.push(...shuffledMultiple.slice(0, config.multiple_choice_count));

		// 抽取判断题
		const shuffledJudge = this.shuffleArray([...judgeQuestions]);
		selectedQuestions.push(...shuffledJudge.slice(0, config.judge_count));

		// 再次打乱顺序
		const finalQuestions = this.shuffleArray(selectedQuestions);

		// 格式化题目数据
		const questions = finalQuestions.map((q) => ({
			id: q.id,
			type: q.type,
			stem: q.stem,
			options: q.options,
			answer: q.answer,
			analysis: q.analysis,
		}));

		return {
			exam_config_id: config.id,
			exam_name: config.name,
			questions,
			question_ids: finalQuestions.map((q) => q.id),
			duration: config.duration,
		};
	}

	/**
	 * 提交考试
	 */
	async submitExam(userId: number, dto: SubmitExamDto) {
		const config = await this.examConfigRepository.findOne({
			where: { id: dto.exam_config_id },
		});

		if (!config) {
			throw new NotFoundException('考试配置不存在');
		}

		// 获取题目信息
		const questionIds = Object.keys(dto.user_answers).map((id) => Number(id));
		const questions = await this.questionRepository.find({
			where: { id: In(questionIds) },
		});

		// 计算分数
		const questionScores: Record<number, number> = {};
		let totalScore = 0;
		let correctCount = 0;

		for (const question of questions) {
			const userAnswer = dto.user_answers[question.id];
			const correctAnswer = question.answer || [];

			// 判断是否正确
			const isCorrect = this.checkAnswer(userAnswer, correctAnswer, question.type);

			// 计算该题得分
			let score = 0;
			if (isCorrect) {
				if (question.type === QuestionType.SINGLE_CHOICE) {
					score = Number(config.single_choice_score);
				} else if (question.type === QuestionType.MULTIPLE_CHOICE) {
					score = Number(config.multiple_choice_score);
				} else if (question.type === QuestionType.JUDGE) {
					score = Number(config.judge_score);
				}
				correctCount++;
			}

			questionScores[question.id] = score;
			totalScore += score;
		}

		// 计算正确率
		const accuracy = questions.length > 0 ? (correctCount / questions.length) * 100 : 0;

		// 判断是否及格
		const isPassed = totalScore >= Number(config.pass_score) ? 1 : 0;

		// 计算用时（秒）
		const startTime = new Date(dto.start_time);
		const submitTime = new Date();
		const durationSeconds = Math.floor((submitTime.getTime() - startTime.getTime()) / 1000);

		// 保存考试记录
		const examRecord = this.examRecordRepository.create({
			user_id: userId,
			exam_config_id: config.id,
			exam_name: config.name,
			question_ids: questionIds,
			user_answers: dto.user_answers,
			question_scores: questionScores,
			total_score: totalScore,
			correct_count: correctCount,
			accuracy: Number(accuracy.toFixed(2)),
			is_passed: isPassed,
			duration_seconds: durationSeconds,
			start_time: startTime,
			submit_time: submitTime,
		});

		await this.examRecordRepository.save(examRecord);

		return {
			exam_record_id: examRecord.id,
			total_score: totalScore,
			full_score: config.full_score,
			correct_count: correctCount,
			total_count: questions.length,
			accuracy: Number(accuracy.toFixed(2)),
			is_passed: isPassed,
			pass_score: config.pass_score,
			duration_seconds: durationSeconds,
			question_scores: questionScores,
		};
	}

	/**
	 * 获取考试记录列表
	 */
	async getExamRecords(userId: number, examConfigId?: number) {
		const where: any = { user_id: userId };
		if (examConfigId) {
			where.exam_config_id = examConfigId;
		}

		const records = await this.examRecordRepository.find({
			where,
			order: { create_time: 'DESC' },
			take: 50, // 最多返回50条
		});

		return records.map((record) => ({
			id: record.id,
			exam_config_id: record.exam_config_id,
			exam_name: record.exam_name,
			total_score: record.total_score,
			correct_count: record.correct_count,
			accuracy: record.accuracy,
			is_passed: record.is_passed,
			duration_seconds: record.duration_seconds,
			start_time: record.start_time,
			submit_time: record.submit_time,
			create_time: record.create_time,
		}));
	}

	/**
	 * 获取考试记录详情
	 */
	async getExamRecordDetail(userId: number, recordId: number) {
		const record = await this.examRecordRepository.findOne({
			where: { id: recordId, user_id: userId },
		});

		if (!record) {
			throw new NotFoundException('考试记录不存在');
		}

		// 获取题目详情
		const questions = await this.questionRepository.find({
			where: { id: In(record.question_ids) },
		});

		// 按顺序组合题目和答案
		const questionDetails = record.question_ids.map((qId) => {
			const question = questions.find((q) => q.id === qId);
			return {
				id: question.id,
				type: question.type,
				stem: question.stem,
				options: question.options,
				answer: question.answer,
				analysis: question.analysis,
				user_answer: record.user_answers[qId],
				score: record.question_scores[qId],
			};
		});

		return {
			id: record.id,
			exam_config_id: record.exam_config_id,
			exam_name: record.exam_name,
			total_score: record.total_score,
			correct_count: record.correct_count,
			accuracy: record.accuracy,
			is_passed: record.is_passed,
			duration_seconds: record.duration_seconds,
			start_time: record.start_time,
			submit_time: record.submit_time,
			questions: questionDetails,
		};
	}

	/**
	 * 检查答案是否正确
	 */
	private checkAnswer(userAnswer: string | string[], correctAnswer: string[], questionType: QuestionType): boolean {
		if (!userAnswer || !correctAnswer || correctAnswer.length === 0) {
			return false;
		}

		const userAnswers = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
		const correctAnswers = correctAnswer.map((a) => String(a).trim().toUpperCase());
		const userAnswersNormalized = userAnswers.map((a) => String(a).trim().toUpperCase());

		// 排序后比较
		correctAnswers.sort();
		userAnswersNormalized.sort();

		// 多选题需要完全匹配
		if (questionType === QuestionType.MULTIPLE_CHOICE) {
			if (correctAnswers.length !== userAnswersNormalized.length) {
				return false;
			}
			return correctAnswers.every((ans, idx) => ans === userAnswersNormalized[idx]);
		}

		// 单选题和判断题只需要第一个答案匹配
		return correctAnswers[0] === userAnswersNormalized[0];
	}

	/**
	 * 数组随机打乱（Fisher-Yates 洗牌算法）
	 */
	private shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}
}
