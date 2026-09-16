ALTER TABLE `distributor`
  ADD COLUMN `frozen_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0 COMMENT '冻结中佣金（元）' AFTER `withdrawable_amount`,
  ADD COLUMN `alipay_account` VARCHAR(120) NULL COMMENT '提现支付宝账号' AFTER `frozen_amount`,
  ADD COLUMN `real_name` VARCHAR(50) NULL COMMENT '提现实名' AFTER `alipay_account`;

ALTER TABLE `distribution_order`
  ADD COLUMN `commission_type` VARCHAR(24) NOT NULL DEFAULT 'base' COMMENT '佣金类型' AFTER `commission_amount`,
  ADD COLUMN `available_at` DATETIME NULL COMMENT '佣金可提现时间' AFTER `settle_time`,
  ADD UNIQUE INDEX `uk_distribution_order_recipient_type` (`order_id`, `distributor_id`, `commission_type`);

ALTER TABLE `distribution_config`
  ADD COLUMN `base_commission_rates` JSON NULL COMMENT '初中高三级基础佣金比例' AFTER `commission_rates`,
  ADD COLUMN `direct_commission_rates` JSON NULL COMMENT '初中高三级直推团队佣金比例' AFTER `base_commission_rates`,
  ADD COLUMN `indirect_commission_rates` JSON NULL COMMENT '初中高三级间推团队佣金比例' AFTER `direct_commission_rates`,
  ADD COLUMN `withdraw_reserve_amount` DECIMAL(10, 2) NOT NULL DEFAULT 20 COMMENT '提现后最低保留余额' AFTER `min_withdraw_amount`,
  ADD COLUMN `withdraw_fee_rate` DECIMAL(5, 2) NOT NULL DEFAULT 5 COMMENT '提现手续费百分比' AFTER `withdraw_reserve_amount`,
  ADD COLUMN `commission_freeze_days` INT NOT NULL DEFAULT 15 COMMENT '佣金冻结天数' AFTER `withdraw_fee_rate`,
  ADD COLUMN `paper_commission_per_kind` DECIMAL(10, 2) NOT NULL DEFAULT 1 COMMENT '每种纸质资料固定佣金' AFTER `commission_freeze_days`;

UPDATE `distribution_config`
SET `max_level` = 3,
    `commission_rates` = JSON_ARRAY(20, 25, 30),
    `base_commission_rates` = JSON_ARRAY(20, 25, 30),
    `direct_commission_rates` = JSON_ARRAY(5, 6, 8),
    `indirect_commission_rates` = JSON_ARRAY(0, 3, 4),
    `min_withdraw_amount` = 100,
    `withdraw_reserve_amount` = 20,
    `withdraw_fee_rate` = 5,
    `commission_freeze_days` = 15,
    `paper_commission_per_kind` = 1
WHERE `id` = 1;

CREATE TABLE IF NOT EXISTS `distributor_withdrawal` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `distributor_id` INT NOT NULL,
  `amount` DECIMAL(10, 2) NOT NULL,
  `fee_amount` DECIMAL(10, 2) NOT NULL,
  `payout_amount` DECIMAL(10, 2) NOT NULL,
  `alipay_account` VARCHAR(120) NOT NULL,
  `real_name` VARCHAR(50) NOT NULL,
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '0待打款 1已打款 2已驳回',
  `remark` VARCHAR(255) NULL,
  `admin_id` INT NULL,
  `processed_at` DATETIME NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_distributor_withdrawal_status` (`distributor_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='代理佣金提现申请';

UPDATE `distribution_order` commissions
JOIN `order` orders ON orders.id = commissions.order_id
SET commissions.available_at = DATE_ADD(COALESCE(orders.paid_time, commissions.create_time), INTERVAL 15 DAY)
WHERE commissions.status = 0 AND commissions.available_at IS NULL;

UPDATE `distributor` distributors
SET distributors.frozen_amount = COALESCE((
  SELECT SUM(commissions.commission_amount)
  FROM `distribution_order` commissions
  WHERE commissions.distributor_id = distributors.id AND commissions.status = 0
), 0);
