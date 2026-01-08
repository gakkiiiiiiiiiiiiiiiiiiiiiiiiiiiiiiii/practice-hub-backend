import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
} from 'typeorm';
import { Course } from './course.entity';

@Entity('exam_config')
export class ExamConfig {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', comment: '课程ID' })
	course_id: number;

	@ManyToOne(() => Course)
	@JoinColumn({ name: 'course_id' })
	course: Course;

	@Column({ type: 'varchar', length: 200, comment: '考试名称' })
	name: string;

	@Column({ type: 'int', comment: '题目数量' })
	question_count: number;

	@Column({ type: 'int', comment: '考试时长（分钟）' })
	duration: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '单选题每题分数' })
	single_choice_score: number;

	@Column({ type: 'int', comment: '单选题数量' })
	single_choice_count: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '多选题每题分数' })
	multiple_choice_score: number;

	@Column({ type: 'int', comment: '多选题数量' })
	multiple_choice_count: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '判断题每题分数' })
	judge_score: number;

	@Column({ type: 'int', comment: '判断题数量' })
	judge_count: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '满分' })
	full_score: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '及格分' })
	pass_score: number;

	@Column({ type: 'text', nullable: true, comment: '考试规则说明' })
	rules: string;

	@Column({ type: 'tinyint', default: 1, comment: '是否启用：0-禁用, 1-启用' })
	is_enabled: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
