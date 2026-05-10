-- 首页推荐增加“分类板块”，二级分类增加封面图

SET @has_home_type = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'home_recommend_category'
    AND COLUMN_NAME = 'type'
);

SET @sql_statement = IF(
  @has_home_type = 0,
  'ALTER TABLE `home_recommend_category` ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT ''course'' COMMENT ''版块类型：course-课程板块，category-分类板块'' AFTER `name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_bind_category_id = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'home_recommend_category'
    AND COLUMN_NAME = 'bind_category_id'
);

SET @sql_statement = IF(
  @has_bind_category_id = 0,
  'ALTER TABLE `home_recommend_category` ADD COLUMN `bind_category_id` INT COMMENT ''分类板块绑定的一级分类ID'' AFTER `type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_category_cover = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course_category'
    AND COLUMN_NAME = 'cover_img'
);

SET @sql_statement = IF(
  @has_category_cover = 0,
  'ALTER TABLE `course_category` ADD COLUMN `cover_img` VARCHAR(500) COMMENT ''二级分类封面图'' AFTER `parent_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_type_index = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'home_recommend_category'
    AND INDEX_NAME = 'idx_home_recommend_category_type'
);

SET @sql_statement = IF(
  @has_type_index = 0,
  'CREATE INDEX `idx_home_recommend_category_type` ON `home_recommend_category` (`type`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_bind_index = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'home_recommend_category'
    AND INDEX_NAME = 'idx_home_recommend_category_bind_category'
);

SET @sql_statement = IF(
  @has_bind_index = 0,
  'CREATE INDEX `idx_home_recommend_category_bind_category` ON `home_recommend_category` (`bind_category_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql_statement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
