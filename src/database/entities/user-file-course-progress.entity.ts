import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_file_course_progress')
@Index(['user_id', 'course_id', 'course_file_id'], { unique: true })
export class UserFileCourseProgress {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  course_id: number;

  @Column({ type: 'int', nullable: true, comment: '文件课程附件ID' })
  course_file_id: number | null;

  @Column({ type: 'int', default: 0, comment: '已读最大页码' })
  current_page: number;

  @Column({ type: 'int', default: 0, comment: '文件总页数' })
  total_pages: number;

  @Column({ type: 'int', default: 0, comment: '累计阅读秒数' })
  total_seconds: number;

  @Column({ type: 'datetime', nullable: true, comment: '最后阅读时间' })
  last_read_at: Date | null;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
