-- 用户代币余额与流水
ALTER TABLE app_user
  ADD COLUMN coin_balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '代币余额（1元=1代币）' AFTER package_expire_time;

CREATE TABLE IF NOT EXISTS coin_transaction (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '用户ID',
  type VARCHAR(30) NOT NULL COMMENT 'recharge|purchase|adjust',
  amount DECIMAL(10, 2) NOT NULL COMMENT '变动金额，充值为正、消费为负',
  balance_after DECIMAL(10, 2) NOT NULL COMMENT '变动后余额',
  order_id INT NULL COMMENT '关联订单ID',
  remark VARCHAR(255) NULL COMMENT '备注',
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_coin_transaction_user (user_id),
  INDEX idx_coin_transaction_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='代币流水';
