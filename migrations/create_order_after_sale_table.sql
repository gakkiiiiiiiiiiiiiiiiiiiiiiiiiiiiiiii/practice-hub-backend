-- ============================================
-- 创建 order_after_sale 表（售后申请表）
-- ============================================

CREATE TABLE IF NOT EXISTS `order_after_sale` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_id` INT NOT NULL COMMENT '订单ID',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `reason` VARCHAR(500) NOT NULL COMMENT '售后原因',
  `description` TEXT COMMENT '详细描述',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '处理状态：0-待处理，1-已处理，2-已拒绝',
  `admin_id` INT DEFAULT NULL COMMENT '处理管理员ID',
  `admin_reply` TEXT COMMENT '管理员回复',
  `process_time` DATETIME DEFAULT NULL COMMENT '处理时间',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`) COMMENT '订单ID索引',
  KEY `idx_user_id` (`user_id`) COMMENT '用户ID索引',
  KEY `idx_status` (`status`) COMMENT '状态索引',
  KEY `idx_create_time` (`create_time`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单售后申请表';
