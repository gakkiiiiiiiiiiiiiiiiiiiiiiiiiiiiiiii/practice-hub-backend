-- 创建分销系统相关表

-- 1. 分销用户表
CREATE TABLE IF NOT EXISTS `distributor` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `user_id` INT NOT NULL UNIQUE COMMENT '用户ID',
  `distributor_code` VARCHAR(50) NOT NULL UNIQUE COMMENT '分销商编号（唯一标识）',
  `qr_code_url` VARCHAR(200) NULL COMMENT '专属二维码URL',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态：0-待审核, 1-已通过, 2-已拒绝, 3-已禁用',
  `reject_reason` TEXT NULL COMMENT '拒绝原因',
  `total_earnings` DECIMAL(10, 2) NOT NULL DEFAULT 0 COMMENT '累计收益（元）',
  `withdrawable_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0 COMMENT '可提现金额（元）',
  `subordinate_count` INT NOT NULL DEFAULT 0 COMMENT '下级用户数量',
  `total_orders` INT NOT NULL DEFAULT 0 COMMENT '累计推广订单数',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_distributor_code` (`distributor_code`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分销用户表';

-- 2. 分销关系表
CREATE TABLE IF NOT EXISTS `distribution_relation` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `user_id` INT NOT NULL UNIQUE COMMENT '用户ID（下级）',
  `distributor_id` INT NOT NULL COMMENT '分销商ID（上级）',
  `level` INT NOT NULL COMMENT '层级（1级、2级、3级等）',
  `source_code` VARCHAR(50) NULL COMMENT '注册来源（分销商编号）',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_distributor_id` (`distributor_id`),
  INDEX `idx_distributor_level` (`distributor_id`, `level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分销关系表';

-- 3. 分销订单表（分成记录）
CREATE TABLE IF NOT EXISTS `distribution_order` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `order_id` INT NOT NULL COMMENT '订单ID',
  `distributor_id` INT NOT NULL COMMENT '分销商ID（获得分成的分销商）',
  `buyer_id` INT NOT NULL COMMENT '购买用户ID',
  `level` INT NOT NULL COMMENT '层级（1级、2级、3级等）',
  `order_amount` DECIMAL(10, 2) NOT NULL COMMENT '订单金额（元）',
  `commission_rate` DECIMAL(5, 2) NOT NULL COMMENT '分成比例（百分比，如 10.5 表示 10.5%）',
  `commission_amount` DECIMAL(10, 2) NOT NULL COMMENT '分成金额（元）',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态：0-待结算, 1-已结算, 2-已取消',
  `settle_time` DATETIME NULL COMMENT '结算时间',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_order_id` (`order_id`),
  INDEX `idx_distributor_id` (`distributor_id`),
  INDEX `idx_distributor_status` (`distributor_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分销订单表（分成记录）';

-- 4. 分销配置表
CREATE TABLE IF NOT EXISTS `distribution_config` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `max_level` INT NOT NULL DEFAULT 3 COMMENT '最大层级数（最多支持几级分销）',
  `commission_rates` JSON NOT NULL COMMENT '各级分成比例配置，如：[10, 5, 2] 表示1级10%，2级5%，3级2%',
  `min_withdraw_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0 COMMENT '最低提现金额（元）',
  `is_enabled` TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用分销系统：0-禁用, 1-启用',
  `description` TEXT NULL COMMENT '分销说明',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分销配置表';

-- 插入默认配置
INSERT INTO `distribution_config` (`id`, `max_level`, `commission_rates`, `min_withdraw_amount`, `is_enabled`, `description`)
VALUES (1, 3, '[10, 5, 2]', 10.00, 1, '分销系统默认配置：1级10%，2级5%，3级2%')
ON DUPLICATE KEY UPDATE `id` = `id`;

