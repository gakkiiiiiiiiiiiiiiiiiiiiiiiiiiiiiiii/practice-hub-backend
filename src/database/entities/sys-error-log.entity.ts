import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('sys_error_log')
export class SysErrorLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10, nullable: true })
  method: string;

  @Column({ length: 1000, nullable: true })
  url: string;

  @Index()
  @Column({ default: 500 })
  status: number;

  @Column({ default: 500 })
  code: number;

  @Column({ length: 1000 })
  message: string;

  @Column({ name: 'error_name', length: 100, nullable: true })
  errorName: string;

  @Column({ type: 'mediumtext', nullable: true })
  stack: string;

  @Column({ name: 'query_text', type: 'text', nullable: true })
  queryText: string;

  @Column({ name: 'sql_message', length: 1000, nullable: true })
  sqlMessage: string;

  @Column({ name: 'request_id', length: 100, nullable: true })
  requestId: string;

  @Column({ length: 100, nullable: true })
  ip: string;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @Column({ name: 'user_agent', length: 500, nullable: true })
  userAgent: string;

  @Column({ type: 'json', nullable: true })
  params: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  query: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  body: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn()
  create_time: Date;
}
