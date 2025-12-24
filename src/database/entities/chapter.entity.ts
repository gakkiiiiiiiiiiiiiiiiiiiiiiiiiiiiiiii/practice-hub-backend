import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
	OneToMany,
} from 'typeorm';
import { Course } from './course.entity';
import { Question } from './question.entity';

export enum ChapterType {
	CHAPTER = 'chapter',
	YEAR = 'year',
}

@Entity('chapter')
export class Chapter {
	@PrimaryGeneratedColumn()
	id: number;

	@Column()
	course_id: number; // 从 subject_id 改为 course_id

	@Column({ length: 100 })
	name: string;

	@Column({
		type: 'enum',
		enum: ChapterType,
		default: ChapterType.CHAPTER,
	})
	type: ChapterType;

	@Column({ type: 'tinyint', default: 0 })
	is_free: number; // 0-否, 1-是（试读）

	@Column({ type: 'int', default: 0 })
	sort: number;

	@CreateDateColumn()
	create_time: Date;

	@UpdateDateColumn()
	update_time: Date;

	@ManyToOne(() => Course, (course) => course.chapters)
	@JoinColumn({ name: 'course_id' })
	course: Course;

	@OneToMany(() => Question, (question) => question.chapter)
	questions: Question[];
}
