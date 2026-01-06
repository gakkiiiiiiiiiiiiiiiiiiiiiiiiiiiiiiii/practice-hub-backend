import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
} from 'typeorm';
import { AppUser } from './app-user.entity';

export enum FeedbackType {
	BUG = 'bug', // 缺陷
	STYLE = 'style', // 样式优化
	FEATURE = 'feature', // 功能需求
}

export enum FeedbackStatus {
	PENDING = 'pending', // 待处理
	PROCESSING = 'processing', // 处理中
	RESOLVED = 'resolved', // 已解决
	REJECTED = 'rejected', // 已拒绝
}

@Entity('feedback')
export class Feedback {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', nullable: true, comment: '用户ID，0表示管理员提交的反馈' })
	user_id: number;

	@ManyToOne(() => AppUser, { nullable: true, createForeignKeyConstraints: false })
	@JoinColumn({ name: 'user_id' })
	user: AppUser;

	@Column({
		type: 'enum',
		enum: FeedbackType,
		comment: '反馈类型：bug=缺陷, style=样式优化, feature=功能需求',
	})
	type: FeedbackType;

	@Column({ type: 'text', comment: '问题描述' })
	description: string;

	@Column({ type: 'json', nullable: true, comment: '图片URL数组' })
	images: string[];

	@Column({
		type: 'enum',
		enum: FeedbackStatus,
		default: FeedbackStatus.PENDING,
		comment: '处理状态：pending=待处理, processing=处理中, resolved=已解决, rejected=已拒绝',
	})
	status: FeedbackStatus;

	@Column({ type: 'text', nullable: true, comment: '管理员回复' })
	reply: string;

	@Column({ type: 'int', nullable: true, comment: '处理人ID' })
	handler_id: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}

