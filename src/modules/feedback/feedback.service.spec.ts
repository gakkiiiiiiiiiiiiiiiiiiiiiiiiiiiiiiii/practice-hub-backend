import { NotFoundException } from '@nestjs/common';
import { Feedback, FeedbackStatus, FeedbackType } from '../../database/entities/feedback.entity';
import { FeedbackService } from './feedback.service';

describe('FeedbackService', () => {
	it('returns normalized image URLs in feedback details', async () => {
		const feedback = {
			id: 8,
			user_id: 1,
			type: FeedbackType.BUG,
			status: FeedbackStatus.PENDING,
			images: ['cloud://prod-env.current-bucket/feedback/example.jpg', 'https://example.com/already-public.png'],
		} as Feedback;
		const repository = {
			findOne: jest.fn().mockResolvedValue(feedback),
		};
		const uploadService = {
			getPublicImageUrl: jest.fn((url: string) =>
				url.startsWith('cloud://') ? 'https://current-bucket.tcb.qcloud.la/feedback/example.jpg' : url
			),
		};
		const service = new FeedbackService(repository as any, uploadService as any);

		const result = await service.getFeedbackDetail(8);

		expect(result.images).toEqual([
			'https://current-bucket.tcb.qcloud.la/feedback/example.jpg',
			'https://example.com/already-public.png',
		]);
	});

	it('limits app feedback details to the current user', async () => {
		const repository = { findOne: jest.fn().mockResolvedValue(null) };
		const service = new FeedbackService(repository as any, { getPublicImageUrl: jest.fn() } as any);

		await expect(service.getUserFeedbackDetail(7, 99)).rejects.toBeInstanceOf(NotFoundException);
		expect(repository.findOne).toHaveBeenCalledWith({
			where: { id: 99, user_id: 7 },
		});
	});

	it('marks a changed administrator reply as unread', async () => {
		const feedback = {
			id: 12,
			user_id: 7,
			type: FeedbackType.FEATURE,
			status: FeedbackStatus.PROCESSING,
			reply: '旧回复',
			reply_time: new Date('2026-08-01T00:00:00Z'),
			reply_read_time: new Date('2026-08-02T00:00:00Z'),
			images: [],
		} as Feedback;
		const repository = {
			findOne: jest.fn().mockResolvedValue(feedback),
			save: jest.fn(async (value) => value),
		};
		const service = new FeedbackService(repository as any, { getPublicImageUrl: jest.fn((url) => url) } as any);

		const result = await service.updateFeedback(12, { reply: '新回复' });

		expect(result.reply).toBe('新回复');
		expect(result.reply_time).toBeInstanceOf(Date);
		expect(result.reply_read_time).toBeNull();
	});
});
