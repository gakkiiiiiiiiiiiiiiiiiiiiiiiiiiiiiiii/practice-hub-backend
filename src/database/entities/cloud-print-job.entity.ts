import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CloudPrintJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUBMITTING = 'submitting',
  WAITING_FILES = 'waiting_files',
  AWAITING_CONFIRM = 'awaiting_confirm',
  RETRYABLE_FAILED = 'retryable_failed',
  REVIEW_REQUIRED = 'review_required',
  SUBMITTED = 'submitted',
  CANCELLED = 'cancelled',
  REFUND_RESERVED = 'refund_reserved',
}

@Entity('cloud_print_job')
@Index(['order_id'], { unique: true })
@Index(['status', 'next_attempt_at'])
export class CloudPrintJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  order_id: number;

  @Column({ type: 'varchar', length: 20, default: CloudPrintJobStatus.PENDING })
  status: CloudPrintJobStatus;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  trigger_type: 'automatic' | 'manual';

  @Column({ type: 'int', nullable: true })
  operator_id: number | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 8 })
  max_attempts: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  external_package_id: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  external_order_id: string | null;

  @Column({ type: 'json', nullable: true })
  request_snapshot: Record<string, any> | null;

  @Column({ type: 'json', nullable: true })
  response_snapshot: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @Column({ type: 'datetime', nullable: true })
  next_attempt_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  locked_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  submitted_at: Date | null;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
