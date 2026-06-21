import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Course } from './course.entity';

export enum ActivationCodeStatus {
	PENDING = 0, // 待用
	USED = 1, // 已用
	INVALID = 2, // 作废
}

export enum ActivationCodeTargetType {
	COURSE = 'course',
	PACKAGE = 'package',
}

export enum ActivationCodeSourceType {
	ADMIN = 'admin', // 管理后台超级管理员生成
	AGENT = 'agent', // 管理后台代理商生成
	DISTRIBUTOR = 'distributor', // 小程序分销购买生成
	APP_ADMIN = 'app_admin', // 小程序管理员生成
}

@Entity('activation_code')
export class ActivationCode {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 50, unique: true })
	code: string;

	@Column({ length: 50 })
	batch_id: string; // 批次ID

	@Column({ nullable: true })
	agent_id: number; // 生成者（代理商ID）

	@Column({
		type: 'varchar',
		length: 30,
		default: ActivationCodeSourceType.ADMIN,
	})
	source_type: ActivationCodeSourceType;

	@Column({ nullable: true })
	source_id: number;

	@Column({ length: 20, nullable: true })
	batch_prefix: string;

	@Column({ nullable: true })
	course_id: number; // 从 subject_id 改为 course_id

	@Column({
		type: 'varchar',
		length: 20,
		default: ActivationCodeTargetType.COURSE,
	})
	target_type: ActivationCodeTargetType;

	@Column({ nullable: true })
	target_id: number;

	@Column({
		type: 'tinyint',
		default: ActivationCodeStatus.PENDING,
	})
	status: ActivationCodeStatus;

	@Column({ nullable: true })
	used_by_uid: number;

	@Column({ type: 'datetime', nullable: true })
	used_time: Date;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	@ManyToOne(() => Course)
	@JoinColumn({ name: 'course_id' })
	course: Course;
}
