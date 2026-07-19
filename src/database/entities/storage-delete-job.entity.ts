import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum StorageDeleteJobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped",
}

export enum StorageDeleteTargetType {
  URL = "url",
  PREFIX = "prefix",
}

@Entity("storage_delete_job")
@Index(["status", "delete_after"])
@Index(["target_type", "target"])
export class StorageDeleteJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 20, default: StorageDeleteTargetType.URL })
  target_type: StorageDeleteTargetType;

  @Column({ type: "varchar", length: 500 })
  target: string;

  @Column({ type: "varchar", length: 100 })
  reason: string;

  @Column({
    type: "varchar",
    length: 20,
    default: StorageDeleteJobStatus.PENDING,
  })
  status: StorageDeleteJobStatus;

  @Column({ type: "int", default: 0 })
  attempts: number;

  @Column({ type: "int", default: 5 })
  max_attempts: number;

  @Column({ type: "text", nullable: true })
  last_error: string | null;

  @Column({ type: "datetime" })
  delete_after: Date;

  @Column({ type: "datetime", nullable: true })
  locked_at: Date | null;

  @Column({ type: "datetime", nullable: true })
  finished_at: Date | null;

  @CreateDateColumn()
  create_time: Date;

  @UpdateDateColumn()
  update_time: Date;
}
