import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Course } from './course.entity';

/**
 * 课程相关推荐实体
 * 只用于存储公共配置（course_id 始终为 null）
 * 课程级别的推荐配置存储在 course 表的 recommended_course_ids 字段中
 */
@Entity('course_recommendation')
export class CourseRecommendation {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'json', comment: '推荐课程ID列表（JSON数组）' })
	recommended_course_ids: number[];

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;
}
