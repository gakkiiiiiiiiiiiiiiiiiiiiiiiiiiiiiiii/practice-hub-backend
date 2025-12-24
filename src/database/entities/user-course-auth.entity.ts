import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum AuthSource {
  PURCHASE = 'purchase',
  CODE = 'code',
}

@Entity('user_course_auth')
export class UserCourseAuth {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  course_id: number; // 从 subject_id 改为 course_id

  @Column({ type: 'datetime', nullable: true })
  expire_time: Date; // 过期时间，null 表示永久

  @Column({
    type: 'enum',
    enum: AuthSource,
    default: AuthSource.PURCHASE,
  })
  source: AuthSource;

  @CreateDateColumn()
  create_time: Date;
}

