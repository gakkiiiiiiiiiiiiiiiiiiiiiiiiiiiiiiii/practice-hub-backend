-- ============================================
-- 数据库迁移脚本：更新 feedback 表支持管理员提交反馈
-- 执行前请务必备份数据库！
-- ============================================

-- 1. 检查并删除外键约束（如果存在）
SET @constraint_name = (
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'feedback'
    AND COLUMN_NAME = 'user_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
    LIMIT 1
);

SET @sql = IF(@constraint_name IS NOT NULL,
    CONCAT('ALTER TABLE `feedback` DROP FOREIGN KEY `', @constraint_name, '`'),
    'SELECT "外键约束不存在，跳过删除" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 修改 user_id 字段为可空，并添加注释
ALTER TABLE `feedback` 
  MODIFY COLUMN `user_id` INT NULL COMMENT '用户ID，0表示管理员提交的反馈';

-- 3. 重新添加外键约束（可选，如果需要保持数据完整性）
-- 注意：由于 user_id 可以为 0 或 null，外键约束可能不适用
-- 如果需要外键约束，可以考虑创建一个 ID 为 0 的系统用户记录

-- ============================================
-- 迁移完成
-- ============================================
-- 验证：
-- SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_COMMENT 
-- FROM information_schema.COLUMNS 
-- WHERE TABLE_SCHEMA = DATABASE() 
-- AND TABLE_NAME = 'feedback' 
-- AND COLUMN_NAME = 'user_id';

