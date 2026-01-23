import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SysUser } from './sys-user.entity';

@Entity('sys_operation_log')
export class SysOperationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  admin_id: number;

  @Column({ length: 50 })
  module: string; // 操作模块

  @Column({ length: 50 })
  action: string; // 动作类型

  @Column({ nullable: true })
  target_id: number; // 目标对象ID

  @Column({ type: 'text', nullable: true })
  content: string; // 操作描述或快照

  @Column({ length: 50, nullable: true })
  ip: string;

  @CreateDateColumn()
  create_time: Date;

  // 关联管理员信息
  @ManyToOne(() => SysUser, { nullable: true })
  @JoinColumn({ name: 'admin_id' })
  admin?: SysUser;
}

