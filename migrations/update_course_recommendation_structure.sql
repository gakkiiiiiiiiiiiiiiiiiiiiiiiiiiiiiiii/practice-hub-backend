-- 修改课程推荐表结构（兼容 MySQL 5.7，可重复执行）

SET @has_recommended_course_ids := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course'
    AND COLUMN_NAME = 'recommended_course_ids'
);

SET @sql := IF(
  @has_recommended_course_ids = 0,
  'ALTER TABLE `course` ADD COLUMN `recommended_course_ids` json DEFAULT NULL COMMENT ''推荐课程ID列表（JSON数组）'' AFTER `introduction`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_course_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course_recommendation'
    AND COLUMN_NAME = 'course_id'
);

SET @has_uk_course_id := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course_recommendation'
    AND INDEX_NAME = 'uk_course_id'
);

SET @sql := IF(
  @has_uk_course_id > 0,
  'ALTER TABLE `course_recommendation` DROP INDEX `uk_course_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_course_id := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course_recommendation'
    AND INDEX_NAME = 'idx_course_id'
);

SET @sql := IF(
  @has_idx_course_id > 0,
  'ALTER TABLE `course_recommendation` DROP INDEX `idx_course_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_course_id > 0,
  'ALTER TABLE `course_recommendation` DROP COLUMN `course_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO `course_recommendation` (`recommended_course_ids`, `create_time`, `update_time`)
SELECT '[]', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `course_recommendation` LIMIT 1);
