import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('user_checkin')
@Index(['user_id', 'checkin_date'], { unique: true }) // 每个用户每天只能打卡一次
export class UserCheckin {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ name: 'user_id' })
	@Index()
	userId: number;

	@Column({ name: 'checkin_date', type: 'date', comment: '打卡日期' })
	checkinDate: Date;

	@Column({ name: 'study_duration', type: 'int', default: 0, comment: '学习时长（秒）' })
	studyDuration: number;

	@Column({ name: 'question_count', type: 'int', default: 0, comment: '答题数量' })
	questionCount: number;

	@CreateDateColumn({ name: 'create_time', type: 'datetime', comment: '创建时间' })
	createTime: Date;
}
