SET @has_agent_level = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'distributor' AND COLUMN_NAME = 'agent_level'
);
SET @sql = IF(
  @has_agent_level = 0,
  'ALTER TABLE distributor ADD COLUMN agent_level TINYINT NOT NULL DEFAULT 1 COMMENT ''代理商等级：1-一级代理, 2-二级代理, 3-三级代理'' AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_agent_prices = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course' AND COLUMN_NAME = 'agent_prices'
);
SET @sql = IF(
  @has_agent_prices = 0,
  'ALTER TABLE course ADD COLUMN agent_prices JSON NULL COMMENT ''各级代理商售价，键为代理等级'' AFTER agent_price',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE course
SET agent_prices = JSON_OBJECT('1', CAST(agent_price AS UNSIGNED))
WHERE agent_prices IS NULL AND agent_price > 0;
