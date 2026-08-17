import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback, FeedbackType, FeedbackStatus } from '../../database/entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { GetFeedbackListDto } from './dto/get-feedback-list.dto';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class FeedbackService {
	constructor(
		@InjectRepository(Feedback)
		private feedbackRepository: Repository<Feedback>,
		private readonly uploadService: UploadService
	) {}

	private normalizeImages(feedback: Feedback): Feedback {
		let images: unknown = feedback.images;
		if (typeof images === 'string') {
			try {
				images = JSON.parse(images);
			} catch {
				images = [];
			}
		}

		feedback.images = Array.isArray(images)
			? images
					.filter((image): image is string => typeof image === 'string' && image.trim().length > 0)
					.map((image) => this.uploadService.getPublicImageUrl(image))
			: [];
		return feedback;
	}

	/**
	 * 创建反馈（小程序端）
	 */
	async createFeedback(userId: number, dto: CreateFeedbackDto): Promise<Feedback> {
		const feedback = this.feedbackRepository.create({
			user_id: userId,
			type: dto.type,
			description: dto.description,
			wechat_contact: String(dto.wechat_contact || '').trim(),
			images: dto.images || [],
			status: FeedbackStatus.PENDING,
		});

		return this.normalizeImages(await this.feedbackRepository.save(feedback));
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
			wechat_contact: String(dto.wechat_contact || '').trim(),
			images: dto.images || [],
			status: FeedbackStatus.PENDING,
			handler_id: adminId, // 记录提交反馈的管理员ID
		});

		return this.normalizeImages(await this.feedbackRepository.save(feedback));
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
			this.normalizeImages(feedback);
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

		const [list, total] = await this.feedbackRepository
			.createQueryBuilder('feedback')
			.where('feedback.user_id = :userId', { userId })
			.addSelect(
				`CASE
          WHEN feedback.reply_time IS NOT NULL
            AND (feedback.reply_read_time IS NULL OR feedback.reply_time > feedback.reply_read_time)
          THEN 1 ELSE 0
        END`,
				'unread_reply_order'
			)
			.orderBy('unread_reply_order', 'DESC')
			.addOrderBy('feedback.create_time', 'DESC')
			.skip(skip)
			.take(pageSize)
			.getManyAndCount();
		const processedList = list.map((feedback) => ({
			...this.normalizeImages(feedback),
			has_unread_reply: this.hasUnreadReply(feedback),
		}));

		return {
			list: processedList,
			total,
			page,
			pageSize,
		};
	}

	private hasUnreadReply(feedback: Feedback): boolean {
		return Boolean(
			feedback.reply?.trim() &&
			feedback.reply_time &&
			(!feedback.reply_read_time || feedback.reply_time > feedback.reply_read_time)
		);
	}

	async getUnreadReplySummary(userId: number) {
		const query = this.feedbackRepository
			.createQueryBuilder('feedback')
			.where('feedback.user_id = :userId', { userId })
			.andWhere("feedback.reply IS NOT NULL AND TRIM(feedback.reply) <> ''")
			.andWhere('feedback.reply_time IS NOT NULL')
			.andWhere('(feedback.reply_read_time IS NULL OR feedback.reply_time > feedback.reply_read_time)');

		const [count, latest] = await Promise.all([
			query.clone().getCount(),
			query.clone().orderBy('feedback.reply_time', 'DESC').getOne(),
		]);

		return {
			count,
			latest: latest
				? {
						id: latest.id,
						type: latest.type,
						description: latest.description,
						status: latest.status,
						reply: latest.reply,
						reply_time: latest.reply_time,
					}
				: null,
		};
	}

	async getUserFeedbackDetail(userId: number, id: number): Promise<Feedback & { has_unread_reply: boolean }> {
		const feedback = await this.feedbackRepository.findOne({
			where: { id, user_id: userId },
		});
		if (!feedback) {
			throw new NotFoundException('反馈不存在');
		}
		const hasUnreadReply = this.hasUnreadReply(feedback);
		return {
			...this.normalizeImages(feedback),
			has_unread_reply: hasUnreadReply,
		};
	}

	async markReplyAsRead(userId: number, id: number) {
		const feedback = await this.feedbackRepository.findOne({
			where: { id, user_id: userId },
		});
		if (!feedback) {
			throw new NotFoundException('反馈不存在');
		}
		if (feedback.reply?.trim() && feedback.reply_time) {
			feedback.reply_read_time = new Date();
			await this.feedbackRepository.save(feedback);
		}
		return { id, has_unread_reply: false };
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

		this.normalizeImages(feedback);

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
			const nextReply = dto.reply.trim();
			const previousReply = feedback.reply?.trim() || '';
			feedback.reply = nextReply;
			if (nextReply !== previousReply) {
				feedback.reply_time = nextReply ? new Date() : null;
				feedback.reply_read_time = null;
			}
		}

		if (handlerId) {
			feedback.handler_id = handlerId;
		}

		return this.normalizeImages(await this.feedbackRepository.save(feedback));
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
