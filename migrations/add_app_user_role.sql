-- 小程序用户角色，admin 可在小程序端不受购买/分销限制生成激活码
SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_user'
    AND COLUMN_NAME = 'role'
);

SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `app_user` ADD COLUMN `role` varchar(20) NOT NULL DEFAULT ''user'' COMMENT ''小程序用户角色：user/admin'' AFTER `phone`',
  'SELECT ''app_user.role already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
