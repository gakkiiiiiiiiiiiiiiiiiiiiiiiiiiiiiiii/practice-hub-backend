import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback, FeedbackType, FeedbackStatus } from '../../database/entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { GetFeedbackListDto } from './dto/get-feedback-list.dto';

@Injectable()
export class FeedbackService {
	constructor(
		@InjectRepository(Feedback)
		private feedbackRepository: Repository<Feedback>
	) {}

	/**
	 * 创建反馈（小程序端）
	 */
	async createFeedback(userId: number, dto: CreateFeedbackDto): Promise<Feedback> {
		const feedback = this.feedbackRepository.create({
			user_id: userId,
			type: dto.type,
			description: dto.description,
			images: dto.images || [],
			status: FeedbackStatus.PENDING,
		});

		return await this.feedbackRepository.save(feedback);
	}

	/**
	 * 创建反馈（管理端）
	 * 管理员提交的反馈使用 user_id = 0 来标识
	 */
	async createAdminFeedback(adminId: number, dto: CreateFeedbackDto): Promise<Feedback> {
		const feedback = this.feedbackRepository.create({
			user_id: 0, // 0 表示管理员提交的反馈
			type: dto.type,
			description: dto.description,
			images: dto.images || [],
			status: FeedbackStatus.PENDING,
			handler_id: adminId, // 记录提交反馈的管理员ID
		});

		return await this.feedbackRepository.save(feedback);
	}

	/**
	 * 获取反馈列表（管理后台）
	 */
	async getFeedbackList(dto: GetFeedbackListDto) {
		const { page = 1, pageSize = 10, type, status, user_id } = dto;
		const skip = (page - 1) * pageSize;

		const queryBuilder = this.feedbackRepository
			.createQueryBuilder('feedback')
			.leftJoinAndSelect('feedback.user', 'user')
			.orderBy('feedback.create_time', 'DESC');

		if (type) {
			queryBuilder.andWhere('feedback.type = :type', { type });
		}

		if (status) {
			queryBuilder.andWhere('feedback.status = :status', { status });
		}

		if (user_id !== undefined) {
			queryBuilder.andWhere('feedback.user_id = :user_id', { user_id });
		}

		const [list, total] = await queryBuilder.skip(skip).take(pageSize).getManyAndCount();

		// 处理管理员提交的反馈（user_id = 0）和 images 字段
		const processedList = list.map((feedback) => {
			// 确保 images 字段是数组格式
			if (feedback.images && !Array.isArray(feedback.images)) {
				try {
					feedback.images = typeof feedback.images === 'string' 
						? JSON.parse(feedback.images) 
						: [];
				} catch (e) {
					feedback.images = [];
				}
			} else if (!feedback.images) {
				feedback.images = [];
			}

			// 处理管理员提交的反馈（user_id = 0）
			if (feedback.user_id === 0 && !feedback.user) {
				feedback.user = {
					id: 0,
					nickname: '管理员',
					avatar: null,
				} as any;
			}
			return feedback;
		});

		return {
			list: processedList,
			total,
			page,
			pageSize,
		};
	}

	/**
	 * 获取用户反馈列表（小程序端）
	 */
	async getUserFeedbackList(userId: number, page: number = 1, pageSize: number = 10) {
		const skip = (page - 1) * pageSize;

		const [list, total] = await this.feedbackRepository.findAndCount({
			where: { user_id: userId },
			order: { create_time: 'DESC' },
			skip,
			take: pageSize,
		});

		return {
			list,
			total,
			page,
			pageSize,
		};
	}

	/**
	 * 获取反馈详情
	 */
	async getFeedbackDetail(id: number): Promise<Feedback> {
		const feedback = await this.feedbackRepository.findOne({
			where: { id },
			relations: ['user'],
		});

		if (!feedback) {
			throw new NotFoundException('反馈不存在');
		}

		// 确保 images 字段是数组格式（TypeORM 会自动解析 JSON，但需要确保格式正确）
		if (feedback.images && !Array.isArray(feedback.images)) {
			try {
				feedback.images = typeof feedback.images === 'string' 
					? JSON.parse(feedback.images) 
					: [];
			} catch (e) {
				feedback.images = [];
			}
		} else if (!feedback.images) {
			feedback.images = [];
		}

		// 处理管理员提交的反馈（user_id = 0）
		if (feedback.user_id === 0 && !feedback.user) {
			feedback.user = {
				id: 0,
				nickname: '管理员',
				avatar: null,
			} as any;
		}

		return feedback;
	}

	/**
	 * 更新反馈（管理后台）
	 */
	async updateFeedback(id: number, dto: UpdateFeedbackDto, handlerId?: number): Promise<Feedback> {
		const feedback = await this.feedbackRepository.findOne({ where: { id } });

		if (!feedback) {
			throw new NotFoundException('反馈不存在');
		}

		if (dto.status) {
			feedback.status = dto.status;
		}

		if (dto.reply !== undefined) {
			feedback.reply = dto.reply;
		}

		if (handlerId) {
			feedback.handler_id = handlerId;
		}

		return await this.feedbackRepository.save(feedback);
	}

	/**
	 * 删除反馈
	 */
	async deleteFeedback(id: number): Promise<void> {
		const result = await this.feedbackRepository.delete(id);
		if (result.affected === 0) {
			throw new NotFoundException('反馈不存在');
		}
	}
}

