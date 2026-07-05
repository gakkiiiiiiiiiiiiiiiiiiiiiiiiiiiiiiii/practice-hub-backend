-- 课程多文件子表 + 阅读进度按文件隔离
-- 若线上已存在下列对象，请勿重复执行。

CREATE TABLE IF NOT EXISTS `course_file` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `course_id` INT NOT NULL,
  `display_name` VARCHAR(255) NOT NULL COMMENT '展示名称（可自定义）',
  `file_url` VARCHAR(500) NOT NULL,
  `file_name` VARCHAR(255) NULL,
  `file_type` VARCHAR(20) NOT NULL,
  `file_size` BIGINT NOT NULL DEFAULT 0,
  `sort` INT NOT NULL DEFAULT 0,
  `file_page_count` INT NULL DEFAULT NULL COMMENT 'PDF 总页数缓存',
  `file_page_count_key` VARCHAR(32) NULL DEFAULT NULL COMMENT '页数缓存对应的文件版本',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0-禁用，1-启用',
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_course_file_course_sort` (`course_id`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件课程附件';

-- 历史单文件课程数据回填；新库尚未建 course 表时跳过
SET @has_course_table := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course'
);

SET @sql := IF(
  @has_course_table > 0,
  'INSERT INTO `course_file` (`course_id`, `display_name`, `file_url`, `file_name`, `file_type`, `file_size`, `sort`, `file_page_count`, `file_page_count_key`, `status`)
   SELECT c.`id`, COALESCE(NULLIF(TRIM(c.`file_name`), ''''), c.`name`), c.`file_url`, c.`file_name`, LOWER(COALESCE(NULLIF(TRIM(c.`file_type`), ''''), ''pdf'')), COALESCE(c.`file_size`, 0), 0, c.`file_page_count`, c.`file_page_count_key`, 1
   FROM `course` c
   WHERE c.`content_type` = ''file''
     AND c.`file_url` IS NOT NULL
     AND TRIM(c.`file_url`) <> ''''
     AND NOT EXISTS (SELECT 1 FROM `course_file` cf WHERE cf.`course_id` = c.`id` LIMIT 1)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 阅读进度：增加 course_file_id；新库尚未建进度表时跳过，由 create_user_file_course_progress_table.sql 初始建表补齐
SET @has_progress_table := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_file_course_progress'
);

SET @has_course_file_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_file_course_progress'
    AND COLUMN_NAME = 'course_file_id'
);

SET @sql := IF(
  @has_progress_table > 0 AND @has_course_file_id = 0,
  'ALTER TABLE `user_file_course_progress` ADD COLUMN `course_file_id` INT NULL DEFAULT NULL COMMENT ''文件课程附件ID'' AFTER `course_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_course_file_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_file_course_progress'
    AND COLUMN_NAME = 'course_file_id'
);

-- 将已有进度关联到各课程的首个文件
SET @sql := IF(
  @has_progress_table > 0 AND @has_course_file_id > 0,
  'UPDATE `user_file_course_progress` p
   INNER JOIN (
     SELECT cf.`course_id`, MIN(cf.`id`) AS `file_id`
     FROM `course_file` cf
     WHERE cf.`status` = 1
     GROUP BY cf.`course_id`
   ) first_file ON first_file.`course_id` = p.`course_id`
   SET p.`course_file_id` = first_file.`file_id`
   WHERE p.`course_file_id` IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 替换唯一索引（线上可能是 uniq_user_file_course_progress 或 IDX_user_file_course_progress_user_course）
SET @has_old_unique := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_file_course_progress'
    AND INDEX_NAME = 'uniq_user_file_course_progress'
);

SET @sql := IF(
  @has_progress_table > 0 AND @has_old_unique > 0,
  'ALTER TABLE `user_file_course_progress` DROP INDEX `uniq_user_file_course_progress`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_old_unique := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_file_course_progress'
    AND INDEX_NAME = 'IDX_user_file_course_progress_user_course'
);

SET @sql := IF(
  @has_progress_table > 0 AND @has_old_unique > 0,
  'ALTER TABLE `user_file_course_progress` DROP INDEX `IDX_user_file_course_progress_user_course`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_new_unique := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_file_course_progress'
    AND INDEX_NAME = 'IDX_user_file_course_progress_user_course_file'
);

SET @sql := IF(
  @has_progress_table > 0 AND @has_course_file_id > 0 AND @has_new_unique = 0,
  'ALTER TABLE `user_file_course_progress` ADD UNIQUE KEY `IDX_user_file_course_progress_user_course_file` (`user_id`, `course_id`, `course_file_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
