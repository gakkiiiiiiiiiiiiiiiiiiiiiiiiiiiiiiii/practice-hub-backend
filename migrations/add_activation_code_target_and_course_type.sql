-- 激活码目标类型与课程类型配置（可重复执行）
SET @db_name := DATABASE();

ALTER TABLE `activation_code`
  MODIFY COLUMN `course_id` int NULL COMMENT '课程激活码对应课程ID，套餐/VIP激活码为空';

SET @has_target_type := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'activation_code'
    AND COLUMN_NAME = 'target_type'
);
SET @sql := IF(
  @has_target_type = 0,
  'ALTER TABLE `activation_code` ADD COLUMN `target_type` varchar(20) NOT NULL DEFAULT ''course'' COMMENT ''激活目标：course/package'' AFTER `course_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_target_id := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'activation_code'
    AND COLUMN_NAME = 'target_id'
);
SET @sql := IF(
  @has_target_id = 0,
  'ALTER TABLE `activation_code` ADD COLUMN `target_id` int NULL COMMENT ''激活目标ID：课程ID或套餐计划ID'' AFTER `target_type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `activation_code`
SET `target_type` = COALESCE(NULLIF(`target_type`, ''), 'course'),
    `target_id` = COALESCE(`target_id`, `course_id`)
WHERE `target_type` IS NULL
   OR `target_type` = ''
   OR `target_id` IS NULL;

CREATE TABLE IF NOT EXISTS `course_type` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL COMMENT '课程类型名称',
  `match_keyword` varchar(100) NOT NULL COMMENT '课程名称包含该关键字时归类',
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '状态：0禁用，1启用',
  `sort` int NOT NULL DEFAULT 0 COMMENT '排序',
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_course_type_status_sort` (`status`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
