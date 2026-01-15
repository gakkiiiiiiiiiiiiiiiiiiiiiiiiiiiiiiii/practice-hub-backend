-- ============================================
-- 修复 home_recommend_item 表的字段名
-- 将 subject_id 改为 course_id
-- ============================================

-- 检查并更新 home_recommend_item 表
-- 如果存在 subject_id 字段但不存在 course_id 字段，则重命名
-- 如果两个字段都不存在，则添加 course_id 字段
-- 如果 course_id 已存在，则跳过

SET @has_subject_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'home_recommend_item'
    AND COLUMN_NAME = 'subject_id'
);

SET @has_course_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'home_recommend_item'
    AND COLUMN_NAME = 'course_id'
);

SET @sql_statement = CASE
  WHEN @has_subject_id > 0 AND @has_course_id = 0 THEN
    'ALTER TABLE `home_recommend_item` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT ''课程ID'''
  WHEN @has_subject_id = 0 AND @has_course_id = 0 THEN
    'ALTER TABLE `home_recommend_item` ADD COLUMN `course_id` INT NOT NULL COMMENT ''课程ID'' AFTER `category_id`'
  ELSE
    'SELECT 1'
END;

PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

