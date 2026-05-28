import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AppUserSessionLoginMethod {
  PASSWORD = 'password',
}

@Entity('app_user_session')
@Index('idx_app_user_session_user_active', ['user_id', 'revoked_at', 'expires_at'])
export class AppUserSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ length: 64, unique: true })
  session_id: string;

  @Column({ length: 64 })
  device_id: string;

  @Column({ length: 100, nullable: true })
  device_name: string;

  @Column({ length: 50, nullable: true })
  platform: string;

  @Column({ type: 'varchar', length: 20, default: AppUserSessionLoginMethod.PASSWORD })
  login_method: AppUserSessionLoginMethod;

  @Column({ type: 'datetime' })
  expires_at: Date;

  @Column({ type: 'datetime', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  last_active_at: Date | null;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
