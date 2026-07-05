CREATE TABLE IF NOT EXISTS `user_file_course_progress` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `course_id` int NOT NULL,
  `course_file_id` int NULL DEFAULT NULL COMMENT '文件课程附件ID',
  `current_page` int NOT NULL DEFAULT 0 COMMENT '已读最大页码',
  `total_pages` int NOT NULL DEFAULT 0 COMMENT '文件总页数',
  `total_seconds` int NOT NULL DEFAULT 0 COMMENT '累计阅读秒数',
  `last_read_at` datetime NULL DEFAULT NULL COMMENT '最后阅读时间',
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_user_file_course_progress_user_course_file` (`user_id`, `course_id`, `course_file_id`),
  KEY `idx_user_file_course_progress_course` (`course_id`),
  KEY `idx_user_file_course_progress_last_read` (`last_read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户文件课程阅读进度';
