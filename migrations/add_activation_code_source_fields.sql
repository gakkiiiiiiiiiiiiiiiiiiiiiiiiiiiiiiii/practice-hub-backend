-- 激活码来源与批次前缀记录（可重复执行）
SET @db_name := DATABASE();

SET @has_source_type := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'activation_code'
    AND COLUMN_NAME = 'source_type'
);
SET @sql := IF(
  @has_source_type = 0,
  'ALTER TABLE `activation_code` ADD COLUMN `source_type` varchar(30) NOT NULL DEFAULT ''admin'' COMMENT ''生成来源：admin/agent/distributor/app_admin'' AFTER `agent_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_id := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'activation_code'
    AND COLUMN_NAME = 'source_id'
);
SET @sql := IF(
  @has_source_id = 0,
  'ALTER TABLE `activation_code` ADD COLUMN `source_id` int NULL COMMENT ''来源主体ID，如后台用户ID、分销商ID、小程序管理员用户ID'' AFTER `source_type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_batch_prefix := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'activation_code'
    AND COLUMN_NAME = 'batch_prefix'
);
SET @sql := IF(
  @has_batch_prefix = 0,
  'ALTER TABLE `activation_code` ADD COLUMN `batch_prefix` varchar(20) NULL COMMENT ''批次号前缀，用于区分生成来源'' AFTER `source_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `activation_code`
SET
  `batch_prefix` = COALESCE(
    `batch_prefix`,
    CASE
      WHEN `batch_id` LIKE 'DST%' THEN 'DST'
      WHEN `batch_id` LIKE 'APP%' THEN 'APP'
      WHEN `batch_id` LIKE 'ADM%' THEN 'ADM'
      WHEN `batch_id` LIKE 'AGT%' THEN 'AGT'
      WHEN `batch_id` LIKE 'D%' THEN 'D'
      ELSE 'BATCH'
    END
  ),
  `source_type` = CASE
    WHEN `source_type` IS NOT NULL AND `source_type` <> '' THEN `source_type`
    WHEN `batch_id` LIKE 'DST%' OR `batch_id` LIKE 'D%' THEN 'distributor'
    WHEN `batch_id` LIKE 'APP%' THEN 'app_admin'
    WHEN `agent_id` IS NOT NULL THEN 'agent'
    ELSE 'admin'
  END,
  `source_id` = CASE
    WHEN `source_id` IS NOT NULL THEN `source_id`
    WHEN `agent_id` IS NOT NULL THEN `agent_id`
    ELSE NULL
  END;
