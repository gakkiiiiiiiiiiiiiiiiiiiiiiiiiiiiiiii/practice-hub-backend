-- 类目套餐激活码权限来源（可重复执行）
SET @db_name := DATABASE();

SET @order_nullable := (
  SELECT IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'user_category_bundle_access'
    AND COLUMN_NAME = 'order_id'
  LIMIT 1
);
SET @sql := IF(
  @order_nullable = 'NO',
  'ALTER TABLE `user_category_bundle_access` MODIFY COLUMN `order_id` int NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_activation_code_id := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'user_category_bundle_access'
    AND COLUMN_NAME = 'activation_code_id'
);
SET @sql := IF(
  @has_activation_code_id = 0,
  'ALTER TABLE `user_category_bundle_access` ADD COLUMN `activation_code_id` int NULL AFTER `order_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_activation_code_key := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'user_category_bundle_access'
    AND INDEX_NAME = 'uk_user_category_bundle_access_activation_code'
);
SET @sql := IF(
  @has_activation_code_key = 0,
  'ALTER TABLE `user_category_bundle_access` ADD UNIQUE KEY `uk_user_category_bundle_access_activation_code` (`activation_code_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
