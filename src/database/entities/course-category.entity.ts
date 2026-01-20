import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('course_category')
export class CourseCategory {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 100 })
	name: string; // 分类名称

	@Column({ type: 'int', nullable: true })
	parent_id: number | null; // 父级分类ID，null表示一级分类

	@Column({ type: 'int', default: 0 })
	sort: number; // 排序

	@Column({ type: 'tinyint', default: 1 })
	status: number; // 0-禁用, 1-启用

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
