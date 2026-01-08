import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('exam_record')
@Index(['user_id', 'exam_config_id'])
@Index(['user_id', 'create_time'])
export class ExamRecord {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'int', comment: '用户ID' })
	user_id: number;

	@Column({ type: 'int', comment: '考试配置ID' })
	exam_config_id: number;

	@Column({ type: 'varchar', length: 200, comment: '考试名称' })
	exam_name: string;

	@Column({ type: 'json', comment: '题目ID列表（按顺序）' })
	question_ids: number[];

	@Column({ type: 'json', comment: '用户答案 { questionId: answer }' })
	user_answers: Record<number, string | string[]>;

	@Column({ type: 'json', comment: '题目得分 { questionId: score }' })
	question_scores: Record<number, number>;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '总分' })
	total_score: number;

	@Column({ type: 'int', comment: '答对题目数' })
	correct_count: number;

	@Column({ type: 'decimal', precision: 5, scale: 2, comment: '正确率（百分比）' })
	accuracy: number;

	@Column({ type: 'tinyint', comment: '是否及格：0-不及格, 1-及格' })
	is_passed: number;

	@Column({ type: 'int', comment: '考试用时（秒）' })
	duration_seconds: number;

	@Column({ type: 'datetime', comment: '开始时间' })
	start_time: Date;

	@Column({ type: 'datetime', comment: '提交时间' })
	submit_time: Date;

	@CreateDateColumn()
	create_time: Date;
}
