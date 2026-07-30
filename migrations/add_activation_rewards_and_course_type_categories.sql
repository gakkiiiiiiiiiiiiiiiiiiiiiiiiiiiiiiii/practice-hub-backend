-- 激活码奖励参数与课程类型分类绑定（可重复执行）
SET @db_name := DATABASE();

SET @has_reward_payload := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'activation_code'
    AND COLUMN_NAME = 'reward_payload'
);
SET @sql := IF(
  @has_reward_payload = 0,
  'ALTER TABLE `activation_code` ADD COLUMN `reward_payload` json NULL COMMENT ''积分/优惠券激活参数'' AFTER `target_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_course_type_category_ids := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'course_type'
    AND COLUMN_NAME = 'category_ids'
);
SET @sql := IF(
  @has_course_type_category_ids = 0,
  'ALTER TABLE `course_type` ADD COLUMN `category_ids` json NULL COMMENT ''可显示的课程分类ID；NULL或空数组表示全部分类'' AFTER `match_keyword`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
