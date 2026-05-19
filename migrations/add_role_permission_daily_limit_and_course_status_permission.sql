-- 角色权限增加每日调用次数限制，并补充课程状态切换权限

SET @db_name := DATABASE();

SET @has_daily_limit := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'sys_role_permission'
    AND COLUMN_NAME = 'daily_limit'
);

SET @sql := IF(
  @has_daily_limit = 0,
  'ALTER TABLE `sys_role_permission` ADD COLUMN `daily_limit` INT NULL COMMENT ''每日调用上限，NULL 表示无限制'' AFTER `permission`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO `sys_role_permission` (`role_id`, `permission`, `daily_limit`)
SELECT r.id, 'course:status', NULL
FROM `sys_role` r
WHERE r.value IN ('super_admin', 'content_admin')
  AND NOT EXISTS (
    SELECT 1
    FROM `sys_role_permission` rp
    WHERE rp.role_id = r.id
      AND rp.permission = 'course:status'
  );
