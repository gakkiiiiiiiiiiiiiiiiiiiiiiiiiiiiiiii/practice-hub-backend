import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ActivationCodeStatus {
	PENDING = 0, // 待用
	USED = 1, // 已用
	INVALID = 2, // 作废
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

	@Column()
	course_id: number; // 从 subject_id 改为 course_id

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
}
