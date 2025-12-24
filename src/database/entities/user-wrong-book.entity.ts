import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_wrong_book')
export class UserWrongBook {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	user_id: number;

	@Column()
	question_id: number;

	@Column()
	course_id: number; // 从 subject_id 改为 course_id

	@Column({ type: 'int', default: 1 })
	error_count: number;

	@Column({ type: 'datetime' })
	last_error_time: Date;

	@Column({ type: 'tinyint', default: 0 })
	is_mastered: number; // 0-未斩题, 1-已斩题

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
