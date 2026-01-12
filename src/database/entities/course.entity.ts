import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Chapter } from './chapter.entity';

@Entity('course')
export class Course {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ length: 100 })
	name: string; // 课程名称

	@Column({ length: 100, nullable: true })
	subject: string; // 科目（如：数学、英语、政治等）

	@Column({ length: 100, nullable: true })
	school: string; // 学校（如：北京大学、清华大学等）

	@Column({ length: 100, nullable: true })
	major: string; // 专业（如：计算机科学与技术、软件工程等）

	@Column({ length: 20, nullable: true })
	exam_year: string; // 真题年份（如：2024、2023等）

	@Column({ length: 20, nullable: true })
	answer_year: string; // 答案年份（如：2024、2023等）

	@Column({ length: 500, nullable: true })
	cover_img: string; // 封面图片

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	price: number; // 价格

	@Column({ type: 'tinyint', default: 0 })
	is_free: number; // 0-付费, 1-免费

	@Column({ type: 'int', default: 0 })
	student_count: number; // 学习人数

	@Column({ type: 'int', default: 0 })
	sort: number; // 排序

	@Column({ type: 'text', nullable: true })
	introduction: string; // 课程介绍（富文本）

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	@OneToMany(() => Chapter, (chapter) => chapter.course)
	chapters: Chapter[];
}
