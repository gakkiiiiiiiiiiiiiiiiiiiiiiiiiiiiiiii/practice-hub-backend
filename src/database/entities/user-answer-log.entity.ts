import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('user_answer_log')
export class UserAnswerLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  question_id: number;

  @Column()
  chapter_id: number; // 章节ID（冗余字段，便于查询）

  @Column({ type: 'json' })
  user_option: string[]; // 用户答案（选项类型题目）

  @Column({ type: 'text', nullable: true })
  text_answer: string; // 文本答案（简答题）

  @Column({ type: 'text', nullable: true })
  image_answer: string; // 图片答案URL（简答题）

  @Column({ type: 'tinyint', nullable: true })
  is_correct: number; // 0-错误, 1-正确, null-待批改（简答题）

  @CreateDateColumn()
  create_time: Date;
}

