import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum PreviewCacheTaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  INTERRUPTED = 'interrupted',
}

@Entity('preview_cache_task')
@Index(['status', 'update_time'])
export class PreviewCacheTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '任务编号' })
  task_no: string;

  @Column({ type: 'varchar', length: 20, default: 'manual', comment: '触发类型：manual/auto' })
  trigger_type: string;

  @Column({ type: 'varchar', length: 20, default: PreviewCacheTaskStatus.PENDING, comment: '任务状态' })
  status: PreviewCacheTaskStatus;

  @Column({ type: 'int', default: 0, comment: '课程总数' })
  total_courses: number;

  @Column({ type: 'int', default: 0, comment: '已处理课程数' })
  processed_courses: number;

  @Column({ type: 'int', nullable: true, comment: '当前处理课程ID' })
  current_course_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '当前处理课程名称' })
  current_course_name: string | null;

  @Column({ type: 'int', default: 0, comment: '当前课程页码' })
  current_page: number;

  @Column({ type: 'int', default: 0, comment: '总页数' })
  total_pages: number;

  @Column({ type: 'int', default: 0, comment: '已处理页数' })
  processed_pages: number;

  @Column({ type: 'int', default: 0, comment: '新生成页数' })
  generated_pages: number;

  @Column({ type: 'int', default: 0, comment: '已存在跳过页数' })
  skipped_pages: number;

  @Column({ type: 'int', default: 0, comment: '失败页数' })
  failed_pages: number;

  @Column({ type: 'text', nullable: true, comment: '任务消息或错误信息' })
  message: string | null;

  @Column({ type: 'longtext', nullable: true, comment: '失败明细(JSON)' })
  failed_details: string | null;

  @Column({ type: 'datetime', nullable: true, comment: '开始时间' })
  started_at: Date | null;

  @Column({ type: 'datetime', nullable: true, comment: '完成时间' })
  finished_at: Date | null;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
