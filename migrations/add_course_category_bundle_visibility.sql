-- 增加课程分类整类购买入口显示开关
-- 默认开启，保留已有“整类购买价”分类的展示行为。

SET @has_bundle_enabled = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course_category'
    AND COLUMN_NAME = 'bundle_enabled'
);

SET @sql_statement = IF(
  @has_bundle_enabled = 0,
  'ALTER TABLE `course_category` ADD COLUMN `bundle_enabled` tinyint NOT NULL DEFAULT 1 COMMENT ''是否显示整类购买入口：0隐藏，1显示'' AFTER `bundle_price`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
