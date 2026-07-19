CREATE TABLE IF NOT EXISTS `storage_delete_job` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `target_type` VARCHAR(20) NOT NULL DEFAULT 'url' COMMENT '删除目标：url/prefix',
  `target` VARCHAR(500) NOT NULL COMMENT '文件 URL 或对象前缀',
  `reason` VARCHAR(100) NOT NULL COMMENT '进入回收队列的原因',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/completed/failed/skipped',
  `attempts` INT NOT NULL DEFAULT 0,
  `max_attempts` INT NOT NULL DEFAULT 5,
  `last_error` TEXT NULL,
  `delete_after` DATETIME NOT NULL COMMENT '安全期结束时间',
  `locked_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_storage_delete_job_status_after` (`status`, `delete_after`),
  KEY `idx_storage_delete_job_target` (`target_type`, `target`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对象存储异步删除任务';
