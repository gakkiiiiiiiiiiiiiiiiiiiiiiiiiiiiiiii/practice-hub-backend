SET @has_file_size = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course'
    AND COLUMN_NAME = 'file_size'
);

SET @sql = IF(
  @has_file_size = 0,
  'ALTER TABLE `course` ADD COLUMN `file_size` BIGINT NOT NULL DEFAULT 0 COMMENT ''文件课程：文件大小（字节）'' AFTER `file_type`',
  'SELECT ''course.file_size already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
