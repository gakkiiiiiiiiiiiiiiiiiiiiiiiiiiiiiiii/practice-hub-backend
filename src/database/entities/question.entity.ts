import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Chapter } from './chapter.entity';

export enum QuestionType {
  SINGLE_CHOICE = 1, // 单选
  MULTIPLE_CHOICE = 2, // 多选
  JUDGE = 3, // 判断
  FILL_BLANK = 4, // 填空
  READING_COMPREHENSION = 5, // 阅读理解
  SHORT_ANSWER = 6, // 简答题
}

export enum Difficulty {
  EASY = 1,
  MEDIUM = 2,
  HARD = 3,
}

@Entity('question')
export class Question {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  chapter_id: number;

  @Column({ default: 0 })
  parent_id: number; // 父题目ID，用于阅读理解

  @Column({
    type: 'tinyint',
  })
  type: QuestionType;

  @Column({ type: 'text' })
  stem: string; // 题干/文章材料（富文本）

  @Column({ type: 'json', nullable: true })
  options: Array<{ label: string; text: string }>; // 选项

  @Column({ type: 'json', nullable: true })
  answer: string[]; // 正确答案

  @Column({ type: 'text', nullable: true })
  analysis: string; // 解析（富文本）

  @Column({
    type: 'tinyint',
    default: Difficulty.MEDIUM,
  })
  difficulty: Difficulty;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;

  @ManyToOne(() => Chapter, (chapter) => chapter.questions)
  @JoinColumn({ name: 'chapter_id' })
  chapter: Chapter;
}

