-- ============================================
-- 修复 home_recommend_item 表的字段名
-- 将 subject_id 改为 course_id
-- ============================================

-- 检查并更新 home_recommend_item 表
-- 如果存在 subject_id 字段但不存在 course_id 字段，则重命名
-- 如果两个字段都不存在，则添加 course_id 字段
-- 如果 course_id 已存在，则跳过

-- 方法1：如果存在 subject_id，重命名为 course_id
SET @has_subject_id = (
    SELECT COUNT(*) 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'home_recommend_item' 
    AND COLUMN_NAME = 'subject_id'
);

SET @has_course_id = (
    SELECT COUNT(*) 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'home_recommend_item' 
    AND COLUMN_NAME = 'course_id'
);

-- 如果存在 subject_id 但不存在 course_id，则重命名
-- 注意：MySQL 不支持在存储过程中直接执行动态 ALTER TABLE，所以需要手动执行

-- 执行以下命令（如果 subject_id 存在但 course_id 不存在）：
-- ALTER TABLE `home_recommend_item` CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';

-- 如果两个字段都不存在，添加 course_id：
-- ALTER TABLE `home_recommend_item` ADD COLUMN `course_id` INT NOT NULL COMMENT '课程ID' AFTER `category_id`;

