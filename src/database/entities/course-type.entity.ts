import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('course_type')
export class CourseType {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 50 })
	name: string;

	@Column({ name: 'match_keyword', length: 100 })
	match_keyword: string;

	@Column({ type: 'tinyint', default: 1 })
	status: number;

	@Column({ type: 'int', default: 0 })
	sort: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
