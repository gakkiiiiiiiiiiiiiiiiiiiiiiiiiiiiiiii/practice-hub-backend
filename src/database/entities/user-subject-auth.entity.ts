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

@Entity('user_subject_auth')
export class UserSubjectAuth {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  subject_id: number;

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

