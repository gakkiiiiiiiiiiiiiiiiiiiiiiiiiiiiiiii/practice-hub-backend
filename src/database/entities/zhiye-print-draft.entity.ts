import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ZhiyePrintDraftStatus {
  UPLOADING = 'uploading',
  UPLOAD_FAILED = 'upload_failed',
  DRAFT = 'draft',
  WAITING_FILES = 'waiting_files',
  QUOTED = 'quoted',
  QUOTE_FAILED = 'quote_failed',
  ORDERED = 'ordered',
}

@Entity('zhiye_print_draft')
@Index('idx_zhiye_print_draft_owner_created', ['user_id', 'create_time'])
@Index('idx_zhiye_print_draft_owner_hash', ['user_id', 'sha256'])
@Index('idx_zhiye_print_draft_quote_cooldown', ['status', 'next_quote_at'])
export class ZhiyePrintDraft {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column({ length: 120 })
  title: string;

  @Column({ length: 255 })
  file_name: string;

  @Column({ length: 500 })
  file_url: string;

  @Column({ type: 'bigint' })
  file_size: number;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'int' })
  page_count: number;

  @Column({ type: 'int', default: 1 })
  copies: number;

  @Column({ type: 'json', nullable: true })
  shipping_address: Record<string, any> | null;

  @Column({ type: 'varchar', length: 30, default: ZhiyePrintDraftStatus.DRAFT })
  status: ZhiyePrintDraftStatus;

  @Column({ type: 'varchar', length: 80, nullable: true })
  external_package_id: string | null;

  @Column({ type: 'int', default: 0 })
  package_create_count: number;

  @Column({ type: 'int', default: 0 })
  package_poll_count: number;

  @Column({ type: 'int', default: 0 })
  quote_attempt_count: number;

  @Column({ type: 'datetime', nullable: true })
  next_quote_at: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  quote_operation_id: string | null;

  @Column({ type: 'int', nullable: true })
  cost_print_amount_cents: number | null;

  @Column({ type: 'int', nullable: true })
  cost_shipping_amount_cents: number | null;

  @Column({ type: 'int', nullable: true })
  cost_total_amount_cents: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true })
  retail_multiplier: number | null;

  @Column({ type: 'int', nullable: true })
  retail_amount_cents: number | null;

  @Column({ type: 'json', nullable: true })
  print_config_snapshot: Record<string, any> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  quote_version: string | null;

  @Column({ type: 'datetime', nullable: true })
  quote_expires_at: Date | null;

  @Column({ type: 'int', nullable: true })
  order_id: number | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
