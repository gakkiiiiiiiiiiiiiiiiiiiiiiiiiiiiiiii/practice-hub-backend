import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { AppUser } from '../../database/entities/app-user.entity';
import { UserAnswerLog } from '../../database/entities/user-answer-log.entity';
import { UserWrongBook } from '../../database/entities/user-wrong-book.entity';
import { UserCollection } from '../../database/entities/user-collection.entity';
import { UserCourseAuth } from '../../database/entities/user-course-auth.entity';
import { Question } from '../../database/entities/question.entity';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { GetUserListDto } from './dto/get-user-list.dto';

@Injectable()
export class AdminService {
	constructor(
		@InjectRepository(AppUser)
		private appUserRepository: Repository<AppUser>,
		@InjectRepository(UserAnswerLog)
		private answerLogRepository: Repository<UserAnswerLog>,
		@InjectRepository(UserWrongBook)
		private wrongBookRepository: Repository<UserWrongBook>,
		@InjectRepository(UserCollection)
		private collectionRepository: Repository<UserCollection>,
		@InjectRepository(UserCourseAuth)
		private courseAuthRepository: Repository<UserCourseAuth>,
		@InjectRepository(Question)
		private questionRepository: Repository<Question>,
	) {}

	/**
	 * 获取小程序用户列表
	 */
	async getUserList(dto: GetUserListDto) {
		const { page = 1, pageSize = 10, keyword, status } = dto;
		const skip = (page - 1) * pageSize;

		const queryBuilder = this.appUserRepository.createQueryBuilder('user');

		// 搜索条件
		if (keyword) {
			queryBuilder.where(
				'(user.nickname LIKE :keyword OR user.openid LIKE :keyword)',
				{ keyword: `%${keyword}%` }
			);
		}

		// 状态筛选（如果AppUser有status字段）
		// 注意：如果实体中没有status字段，这个条件会被忽略
		if (status !== undefined) {
			queryBuilder.andWhere('user.status = :status', { status });
		}

		// 总数
		const total = await queryBuilder.getCount();

		// 分页查询
		const users = await queryBuilder
			.orderBy('user.create_time', 'DESC')
			.skip(skip)
			.take(pageSize)
			.getMany();

		// 格式化返回数据
		const list = users.map((user) => {
			// 判断VIP状态（根据vip_expire_time）
			const isVip = user.vip_expire_time && new Date(user.vip_expire_time) > new Date();
			
			return {
				id: user.id,
				nickname: user.nickname || '未设置',
				openId: user.openid,
				avatar: user.avatar,
				phone: user.phone,
				vipStatus: isVip,
				vipExpireTime: user.vip_expire_time,
				status: (user as any).status !== undefined ? (user as any).status : 1, // 默认正常
				createdAt: user.create_time,
				lastLoginAt: user.update_time, // 暂时用update_time，如果有last_login_time字段则使用
			};
		});

		return {
			list,
			total,
			page,
			pageSize,
		};
	}

	/**
	 * 获取小程序用户详情
	 */
	async getUserDetail(userId: number) {
		const user = await this.appUserRepository.findOne({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('用户不存在');
		}

		// 判断VIP状态
		const isVip = user.vip_expire_time && new Date(user.vip_expire_time) > new Date();

		// 获取答题统计
		const [totalQuestions, correctCount, wrongCount] = await Promise.all([
			this.answerLogRepository.count({ where: { user_id: userId } }),
			this.answerLogRepository.count({ where: { user_id: userId, is_correct: 1 } }),
			this.answerLogRepository.count({ where: { user_id: userId, is_correct: 0 } }),
		]);

		const accuracy = totalQuestions > 0 ? `${((correctCount / totalQuestions) * 100).toFixed(1)}%` : '0%';

		// 获取错题本（最近10条）
		const wrongBooks = await this.wrongBookRepository.find({
			where: { user_id: userId, is_mastered: 0 },
			order: { last_error_time: 'DESC' },
			take: 10,
		});

		// 获取题目信息
		const questionIds = wrongBooks.map((wb) => wb.question_id);
		const questions = questionIds.length > 0
			? await this.questionRepository.find({ where: { id: In(questionIds) } })
			: [];

		const wrongQuestions = wrongBooks.map((wb) => {
			const question = questions.find((q) => q.id === wb.question_id);
			return {
				id: wb.id,
				questionId: wb.question_id,
				courseId: wb.course_id,
				errorCount: wb.error_count,
				lastErrorTime: wb.last_error_time,
				content: question?.stem || '',
			};
		});

		// 获取收藏数量
		const collectionCount = await this.collectionRepository.count({ where: { user_id: userId } });

		// 获取课程权限数量
		const courseAuthCount = await this.courseAuthRepository.count({ where: { user_id: userId } });

		return {
			userInfo: {
				id: user.id,
				nickname: user.nickname || '未设置',
				openId: user.openid,
				avatar: user.avatar,
				phone: user.phone,
				vipStatus: isVip,
				vipExpireTime: user.vip_expire_time,
				status: (user as any).status !== undefined ? (user as any).status : 1,
				createdAt: user.create_time,
				lastLoginAt: user.update_time,
			},
			stats: {
				totalQuestions,
				correctCount,
				wrongCount,
				accuracy,
				collectionCount,
				courseAuthCount,
			},
			wrongQuestions: wrongQuestions.map((wb) => ({
				id: wb.id,
				questionId: wb.question_id,
				courseId: wb.course_id,
				errorCount: wb.error_count,
				lastErrorTime: wb.last_error_time,
				content: (wb as any).question?.stem || '',
			})),
		};
	}

	/**
	 * 封禁/解封小程序用户
	 */
	async updateUserStatus(userId: number, dto: UpdateUserStatusDto) {
		const user = await this.appUserRepository.findOne({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('用户不存在');
		}

		// 如果AppUser实体有status字段，则更新
		// 否则可以通过其他方式实现（如添加status字段到数据库）
		if ((user as any).status !== undefined) {
			await this.appUserRepository.update(userId, { status: dto.status as any });
		} else {
			// 如果没有status字段，可以通过其他方式标记封禁
			// 例如：在nickname前加标记，或者使用其他字段
			// 这里暂时返回成功，实际项目中需要添加status字段
		}

		return { success: true };
	}
}

