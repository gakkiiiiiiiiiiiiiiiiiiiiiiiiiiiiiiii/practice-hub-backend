-- 小程序账号密码登录 + 设备会话（最多3台设备）

SET @username_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_user'
    AND COLUMN_NAME = 'username'
);

SET @sql := IF(
  @username_exists = 0,
  'ALTER TABLE `app_user`
    ADD COLUMN `username` varchar(50) NULL COMMENT ''账号登录用户名'' AFTER `openid`,
    ADD COLUMN `password_hash` varchar(255) NULL COMMENT ''账号登录密码哈希'' AFTER `username`,
    ADD UNIQUE KEY `uniq_app_user_username` (`username`)',
  'SELECT ''app_user.username already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `app_user_session` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `device_id` varchar(64) NOT NULL,
  `device_name` varchar(100) DEFAULT NULL,
  `platform` varchar(50) DEFAULT NULL,
  `login_method` varchar(20) NOT NULL DEFAULT 'password',
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `last_active_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_app_user_session_session_id` (`session_id`),
  KEY `idx_app_user_session_user_active` (`user_id`, `revoked_at`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序账号登录设备会话';
