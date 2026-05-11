-- 首页推荐板块：小程序端每行显示列数
SET @db_name := DATABASE();
SET @table_name := 'home_recommend_category';
SET @column_name := 'columns';
SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = @table_name
    AND COLUMN_NAME = @column_name
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `home_recommend_category` ADD COLUMN `columns` INT NOT NULL DEFAULT 3 COMMENT ''小程序端每行显示列数'' AFTER `sort`',
  'SELECT ''home_recommend_category.columns already exists'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `home_recommend_category`
SET `columns` = 3
WHERE `columns` IS NULL OR `columns` < 1 OR `columns` > 4;
