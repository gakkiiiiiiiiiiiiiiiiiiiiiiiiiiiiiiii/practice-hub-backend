import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { ExamRecord } from '../../database/entities/exam-record.entity';
import { Question } from '../../database/entities/question.entity';
import { Chapter } from '../../database/entities/chapter.entity';
import { Course } from '../../database/entities/course.entity';
import { GetTrajectoryDto } from './dto/get-trajectory.dto';

@Injectable()
export class TrajectoryService {
	constructor(
		@InjectRepository(UserAnswerLog)
		private answerLogRepository: Repository<UserAnswerLog>,
		@InjectRepository(ExamRecord)
		private examRecordRepository: Repository<ExamRecord>,
		@InjectRepository(Question)
		private questionRepository: Repository<Question>,
		@InjectRepository(Chapter)
		private chapterRepository: Repository<Chapter>,
		@InjectRepository(Course)
		private courseRepository: Repository<Course>,
	) {}

	/**
	 * 获取学习轨迹列表
	 */
	async getTrajectoryList(userId: number, dto: GetTrajectoryDto) {
		const { period = 'all' } = dto;

		// 计算时间范围
		const now = new Date();
		let startDate: Date | null = null;

		if (period === 'week') {
			// 本周开始（周一 00:00:00）
			const dayOfWeek = now.getDay();
			const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 如果是周日，往前推6天
			startDate = new Date(now);
			startDate.setDate(now.getDate() - diff);
			startDate.setHours(0, 0, 0, 0);
		} else if (period === 'month') {
			// 本月开始
			startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
		}

		// 获取答题记录
		const answerLogQuery = this.answerLogRepository
			.createQueryBuilder('log')
			.where('log.user_id = :userId', { userId })
			.orderBy('log.create_time', 'DESC');

		if (startDate) {
			answerLogQuery.andWhere('log.create_time >= :startDate', { startDate });
		}

		const answerLogs = await answerLogQuery.getMany();

		// 获取考试记录
		const examRecordQuery = this.examRecordRepository
			.createQueryBuilder('exam')
			.where('exam.user_id = :userId', { userId })
			.orderBy('exam.create_time', 'DESC');

		if (startDate) {
			examRecordQuery.andWhere('exam.create_time >= :startDate', { startDate });
		}

		const examRecords = await examRecordQuery.getMany();

		// 合并并格式化数据
		const trajectoryList = [];

		// 处理答题记录
		for (const log of answerLogs) {
			const question = await this.questionRepository.findOne({
				where: { id: log.question_id },
			});

			if (question) {
				// 获取章节信息
				let chapter = null;
				let course = null;
				if (log.chapter_id) {
					chapter = await this.chapterRepository.findOne({
						where: { id: log.chapter_id },
						relations: ['course'],
					});
					if (chapter) {
						course = chapter.course;
					}
				}

				const courseName = course?.name || '未知课程';
				const chapterName = chapter?.name || '未知章节';
				const questionTypeMap = {
					single: '单选题',
					multiple: '多选题',
					judge: '判断题',
					fill_blank: '填空题',
					short: '简答题',
				};
				const questionType = questionTypeMap[question.type] || '题目';

				trajectoryList.push({
					id: `answer_${log.id}`,
					type: 'answer',
					action: `完成${questionType}`,
					description: `${courseName} - ${chapterName}`,
					isCorrect: log.is_correct === 1,
					createTime: log.create_time,
					date: log.create_time,
					questionId: log.question_id,
					courseId: course?.id,
					chapterId: chapter?.id,
				});
			}
		}

		// 处理考试记录
		for (const exam of examRecords) {
			trajectoryList.push({
				id: `exam_${exam.id}`,
				type: 'exam',
				action: '完成考试',
				description: exam.exam_name,
				score: exam.total_score,
				accuracy: exam.accuracy,
				isPassed: exam.is_passed === 1,
				createTime: exam.create_time,
				date: exam.create_time,
				examId: exam.id,
			});
		}

		// 按时间倒序排序
		trajectoryList.sort((a, b) => {
			return new Date(b.createTime).getTime() - new Date(a.createTime).getTime();
		});

		// 计算统计数据
		const stats = this.calculateStats(answerLogs, examRecords, startDate);

		return {
			list: trajectoryList,
			stats,
		};
	}

	/**
	 * 计算统计数据
	 */
	private calculateStats(
		answerLogs: UserAnswerLog[],
		examRecords: ExamRecord[],
		startDate: Date | null,
	) {
		const totalAnswers = answerLogs.length;
		const correctAnswers = answerLogs.filter((log) => log.is_correct === 1).length;
		const accuracy = totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0;

		const totalExams = examRecords.length;
		const passedExams = examRecords.filter((exam) => exam.is_passed === 1).length;

		// 计算学习天数（去重）
		const studyDays = new Set<string>();
		answerLogs.forEach((log) => {
			const date = new Date(log.create_time);
			studyDays.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
		});
		examRecords.forEach((exam) => {
			const date = new Date(exam.create_time);
			studyDays.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
		});

		return {
			totalAnswers,
			correctAnswers,
			accuracy: Number(accuracy.toFixed(2)),
			totalExams,
			passedExams,
			studyDays: studyDays.size,
		};
	}
}
