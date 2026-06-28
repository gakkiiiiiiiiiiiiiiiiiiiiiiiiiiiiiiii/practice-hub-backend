-- 纸质专业真题：订单增加实物发货收货地址
-- 课程类型复用 course.content_type 字符串字段，无需新增课程表字段。

SET @has_shipping_address = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order'
    AND COLUMN_NAME = 'shipping_address'
);

SET @sql_statement = IF(
  @has_shipping_address = 0,
  'ALTER TABLE `order` ADD COLUMN `shipping_address` JSON NULL COMMENT ''实物订单收货地址'' AFTER `pay_payload`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
