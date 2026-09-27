-- 阿奇索独立供货 API：商户、商品映射、预充值余额、订单与权益归因。
-- 仅建表，不创建商户、不充值、不启用商品，可重复执行。

CREATE TABLE IF NOT EXISTS `agiso_partner` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `client_id` VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `client_secret_hash` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `balance` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0=禁用, 1=启用',
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_partner_client_id` (`client_id`),
  KEY `idx_agiso_partner_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阿奇索 API 商户与预充值余额';

CREATE TABLE IF NOT EXISTS `agiso_product` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `product_name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `target_type` VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'course/package/category_bundle',
  `target_id` INT NOT NULL,
  `supply_price` DECIMAL(12,2) NULL COMMENT '独立供货价，NULL 表示未定价',
  `enabled` TINYINT NOT NULL DEFAULT 0 COMMENT '默认禁用，人工核验映射和价格后启用',
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_product_name` (`product_name`),
  UNIQUE KEY `uk_agiso_product_target` (`target_type`, `target_id`),
  KEY `idx_agiso_product_enabled` (`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阿奇索商品名到小程序权益的精确映射';

CREATE TABLE IF NOT EXISTS `agiso_order` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `partner_id` INT NOT NULL,
  `order_no` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `product_id` INT NOT NULL,
  `product_name_snapshot` VARCHAR(255) NOT NULL,
  `target_type` VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_id` INT NOT NULL,
  `supply_price` DECIMAL(12,2) NOT NULL,
  `activation_code_id` INT NOT NULL,
  `status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'issued' COMMENT 'issued/revoked',
  `issued_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `revoked_at` DATETIME(6) NULL,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_order_partner_order_no` (`partner_id`, `order_no`),
  UNIQUE KEY `uk_agiso_order_activation_code` (`activation_code_id`),
  KEY `idx_agiso_order_status` (`partner_id`, `status`, `issued_at`),
  CONSTRAINT `fk_agiso_order_partner` FOREIGN KEY (`partner_id`) REFERENCES `agiso_partner` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_agiso_order_product` FOREIGN KEY (`product_id`) REFERENCES `agiso_product` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_agiso_order_activation_code` FOREIGN KEY (`activation_code_id`) REFERENCES `activation_code` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阿奇索发码订单，一单固定一枚激活码';

CREATE TABLE IF NOT EXISTS `agiso_balance_ledger` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `partner_id` INT NOT NULL,
  `order_id` BIGINT NULL,
  `event_type` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'topup/issue_debit/revoke_refund',
  `biz_ref` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL COMMENT '充值等人工业务的唯一凭证',
  `amount` DECIMAL(12,2) NOT NULL,
  `balance_after` DECIMAL(12,2) NOT NULL,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_ledger_order_event` (`order_id`, `event_type`),
  UNIQUE KEY `uk_agiso_ledger_partner_event_ref` (`partner_id`, `event_type`, `biz_ref`),
  KEY `idx_agiso_ledger_partner_time` (`partner_id`, `create_time`),
  CONSTRAINT `fk_agiso_ledger_partner` FOREIGN KEY (`partner_id`) REFERENCES `agiso_partner` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_agiso_ledger_order` FOREIGN KEY (`order_id`) REFERENCES `agiso_order` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阿奇索不可变预充值余额流水';

CREATE TABLE IF NOT EXISTS `agiso_code_grant` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `activation_code_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `target_type` VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_id` INT NOT NULL,
  `granted_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `duration_days` INT NULL COMMENT '套餐码时为本次增加天数，课程/类目为空',
  `revoked_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_code_grant_activation_code` (`activation_code_id`),
  KEY `idx_agiso_code_grant_user_target` (`user_id`, `target_type`, `target_id`),
  CONSTRAINT `fk_agiso_code_grant_activation_code` FOREIGN KEY (`activation_code_id`) REFERENCES `activation_code` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_agiso_code_grant_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阿奇索激活码核销权益的精确归因';

CREATE TABLE IF NOT EXISTS `agiso_package_state` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `section_id` INT NOT NULL,
  `baseline_expire_time` DATETIME(6) NULL COMMENT '开始事件追踪前的套餐到期时间',
  `tracking_started_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_package_state_user_section` (`user_id`, `section_id`),
  CONSTRAINT `fk_agiso_package_state_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_agiso_package_state_section` FOREIGN KEY (`section_id`) REFERENCES `package_section` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐事件账本接管前的基线';

CREATE TABLE IF NOT EXISTS `agiso_package_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `section_id` INT NOT NULL,
  `source_type` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'code/order',
  `source_id` BIGINT NOT NULL COMMENT 'code=activation_code.id, order=order.id',
  `granted_at` DATETIME(6) NOT NULL,
  `duration_days` INT NOT NULL,
  `revoked_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agiso_package_event_source` (`source_type`, `source_id`),
  KEY `idx_agiso_package_event_projection` (`user_id`, `section_id`, `granted_at`, `id`),
  CONSTRAINT `fk_agiso_package_event_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_agiso_package_event_section` FOREIGN KEY (`section_id`) REFERENCES `package_section` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐授予事件账本，用于按来源精准撤销并重算';
