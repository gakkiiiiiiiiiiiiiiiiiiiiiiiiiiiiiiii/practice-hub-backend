-- 二级分类所属书本筛选项。为空时小程序端不展示“所属书本”筛选。
SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'course_category'
    AND COLUMN_NAME = 'book_names'
);

SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `course_category` ADD COLUMN `book_names` JSON NULL COMMENT ''二级分类所属书本筛选项'' AFTER `bundle_enabled`',
  'SELECT ''course_category.book_names already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
