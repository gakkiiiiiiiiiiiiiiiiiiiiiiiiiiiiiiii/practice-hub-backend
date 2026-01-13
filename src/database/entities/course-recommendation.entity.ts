import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Course } from './course.entity';

/**
 * 课程相关推荐实体
 * course_id 为 null 时表示公共配置，否则表示该课程的单独配置
 */
@Entity('course_recommendation')
export class CourseRecommendation {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', nullable: true, comment: '课程ID，null表示公共配置' })
	course_id: number | null;

	@ManyToOne(() => Course, { nullable: true })
	@JoinColumn({ name: 'course_id' })
	course: Course | null;

	@Column({ type: 'json', comment: '推荐课程ID列表' })
	recommended_course_ids: number[];

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
