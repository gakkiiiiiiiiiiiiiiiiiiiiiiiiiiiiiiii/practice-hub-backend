SET @index_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'order'
    AND index_name = 'idx_order_status_create_time'
);

SET @index_sql = IF(
  @index_exists = 0,
  'CREATE INDEX `idx_order_status_create_time` ON `order` (`status`, `create_time`)',
  'SELECT 1'
);

PREPARE order_index_statement FROM @index_sql;
EXECUTE order_index_statement;
DEALLOCATE PREPARE order_index_statement;
