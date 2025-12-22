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

  @Column({ type: 'json' })
  user_option: string[]; // 用户答案

  @Column({ type: 'tinyint' })
  is_correct: number; // 0-错误, 1-正确

  @CreateDateColumn()
  create_time: Date;
}

