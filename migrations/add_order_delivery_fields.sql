-- 纸质专业真题：订单增加发货和物流查询字段

SET @has_delivery_status = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'delivery_status'
);
SET @sql_statement = IF(
  @has_delivery_status = 0,
  'ALTER TABLE `order` ADD COLUMN `delivery_status` varchar(20) NOT NULL DEFAULT ''pending'' COMMENT ''实物订单发货状态'' AFTER `shipping_address`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tracking_no = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'tracking_no'
);
SET @sql_statement = IF(
  @has_tracking_no = 0,
  'ALTER TABLE `order` ADD COLUMN `tracking_no` varchar(80) NULL COMMENT ''物流运单号'' AFTER `delivery_status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_shipper_code = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'shipper_code'
);
SET @sql_statement = IF(
  @has_shipper_code = 0,
  'ALTER TABLE `order` ADD COLUMN `shipper_code` varchar(40) NULL COMMENT ''物流公司编码'' AFTER `tracking_no`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_shipper_name = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'shipper_name'
);
SET @sql_statement = IF(
  @has_shipper_name = 0,
  'ALTER TABLE `order` ADD COLUMN `shipper_name` varchar(80) NULL COMMENT ''物流公司名称'' AFTER `shipper_code`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_shipped_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'shipped_at'
);
SET @sql_statement = IF(
  @has_shipped_at = 0,
  'ALTER TABLE `order` ADD COLUMN `shipped_at` datetime NULL COMMENT ''发货时间'' AFTER `shipper_name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ship_operator_type = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'ship_operator_type'
);
SET @sql_statement = IF(
  @has_ship_operator_type = 0,
  'ALTER TABLE `order` ADD COLUMN `ship_operator_type` varchar(20) NULL COMMENT ''发货操作人类型'' AFTER `shipped_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ship_operator_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'ship_operator_id'
);
SET @sql_statement = IF(
  @has_ship_operator_id = 0,
  'ALTER TABLE `order` ADD COLUMN `ship_operator_id` int NULL COMMENT ''发货操作人ID'' AFTER `ship_operator_type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_shipment_remark = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'shipment_remark'
);
SET @sql_statement = IF(
  @has_shipment_remark = 0,
  'ALTER TABLE `order` ADD COLUMN `shipment_remark` varchar(255) NULL COMMENT ''发货备注'' AFTER `ship_operator_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_logistics_snapshot = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order' AND COLUMN_NAME = 'logistics_snapshot'
);
SET @sql_statement = IF(
  @has_logistics_snapshot = 0,
  'ALTER TABLE `order` ADD COLUMN `logistics_snapshot` json NULL COMMENT ''最近一次物流查询快照'' AFTER `shipment_remark`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
