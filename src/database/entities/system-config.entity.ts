import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_config')
export class SystemConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'config_key', type: 'varchar', length: 100, unique: true, comment: '配置键' })
  configKey: string;

  @Column({ name: 'config_value', type: 'text', comment: '配置值（JSON格式）' })
  configValue: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true, comment: '配置描述' })
  description: string;

  @CreateDateColumn({ name: 'create_time', type: 'datetime', comment: '创建时间' })
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time', type: 'datetime', comment: '更新时间' })
  updateTime: Date;
}
