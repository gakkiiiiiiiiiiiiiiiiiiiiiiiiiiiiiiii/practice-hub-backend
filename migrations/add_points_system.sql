-- 积分系统
ALTER TABLE app_user
  ADD COLUMN points_balance INT NOT NULL DEFAULT 0 COMMENT '积分余额' AFTER coin_balance;

CREATE TABLE IF NOT EXISTS user_points_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  change_amount INT NOT NULL COMMENT '变动积分，正数为增加，负数为减少',
  balance_after INT NOT NULL COMMENT '变动后余额',
  type VARCHAR(30) NOT NULL COMMENT 'checkin/exchange/adjust',
  remark VARCHAR(255) NULL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_user_points_log_user_id (user_id),
  INDEX idx_user_points_log_create_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户积分流水';

INSERT INTO system_config (config_key, config_value, description, create_time, update_time)
SELECT 'points_config', '{"enabled":true,"checkin_reward":50,"exchange_points":500,"exchange_coupon_amount":5,"exchange_coupon_min_amount":0,"coupon_valid_days":365}', '积分系统配置', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE config_key = 'points_config');
