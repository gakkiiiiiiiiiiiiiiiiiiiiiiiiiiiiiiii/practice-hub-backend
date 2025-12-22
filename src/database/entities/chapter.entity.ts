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
import { Subject } from './subject.entity';
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
  subject_id: number;

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

  @ManyToOne(() => Subject, (subject) => subject.chapters)
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @OneToMany(() => Question, (question) => question.chapter)
  questions: Question[];
}

