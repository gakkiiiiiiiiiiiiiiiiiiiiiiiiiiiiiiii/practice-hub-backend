-- 拉新优惠券 + 套餐服务

-- 拉新关系
CREATE TABLE IF NOT EXISTS `user_referral` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `inviter_user_id` INT NOT NULL COMMENT '邀请人用户ID',
  `invitee_user_id` INT NOT NULL COMMENT '被邀请人用户ID',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitee` (`invitee_user_id`),
  KEY `idx_inviter` (`inviter_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户拉新关系';

-- 用户优惠券
CREATE TABLE IF NOT EXISTS `user_coupon` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '优惠金额',
  `min_amount` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '最低消费，0表示无门槛',
  `status` VARCHAR(20) NOT NULL DEFAULT 'unused' COMMENT 'unused/used/expired',
  `source` VARCHAR(30) NOT NULL DEFAULT 'referral' COMMENT '来源',
  `used_order_id` INT NULL,
  `expire_time` DATETIME NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户优惠券';

-- 套餐
CREATE TABLE IF NOT EXISTS `package_section` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT NULL,
  `cover_img` VARCHAR(500) NULL,
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0禁用 1启用',
  `sort` INT NOT NULL DEFAULT 0,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='套餐';

-- 套餐范围
CREATE TABLE IF NOT EXISTS `package_section_scope` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `section_id` INT NOT NULL,
  `scope_type` VARCHAR(20) NOT NULL COMMENT 'course/category/sub_category',
  `scope_value` VARCHAR(100) NOT NULL COMMENT '课程ID或分类名称',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_section` (`section_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='套餐绑定范围';

-- VIP 套餐
CREATE TABLE IF NOT EXISTS `package_plan` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `section_id` INT NOT NULL,
  `plan_type` VARCHAR(20) NOT NULL COMMENT 'monthly/quarterly/yearly',
  `name` VARCHAR(50) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `duration_days` INT NOT NULL DEFAULT 30,
  `status` TINYINT NOT NULL DEFAULT 1,
  `sort` INT NOT NULL DEFAULT 0,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_section` (`section_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='套餐规格';

-- 用户套餐订阅
CREATE TABLE IF NOT EXISTS `user_package_subscription` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `section_id` INT NOT NULL,
  `expire_time` DATETIME NOT NULL,
  `order_id` INT NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_section` (`user_id`, `section_id`),
  KEY `idx_expire` (`expire_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户VIP订阅';

-- 订单表扩展
ALTER TABLE `order`
  MODIFY COLUMN `course_id` INT NULL,
  ADD COLUMN `order_type` VARCHAR(20) NOT NULL DEFAULT 'course' COMMENT 'course/package' AFTER `course_id`,
  ADD COLUMN `package_section_id` INT NULL AFTER `order_type`,
  ADD COLUMN `package_plan_id` INT NULL AFTER `package_section_id`,
  ADD COLUMN `coupon_id` INT NULL AFTER `package_plan_id`,
  ADD COLUMN `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `coupon_id`,
  ADD COLUMN `original_amount` DECIMAL(10,2) NULL AFTER `discount_amount`;
