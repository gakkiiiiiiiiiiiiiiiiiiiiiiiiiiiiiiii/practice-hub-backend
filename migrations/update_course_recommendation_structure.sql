-- 修改课程推荐表结构
-- 1. 在 course 表中添加 recommended_course_ids 字段
-- 2. 修改 course_recommendation 表，移除 course_id 字段（只用于公共配置）
-- 3. 创建默认的公共配置数据

-- 1. 在 course 表中添加 recommended_course_ids 字段
ALTER TABLE `course` 
ADD COLUMN IF NOT EXISTS `recommended_course_ids` json DEFAULT NULL COMMENT '推荐课程ID列表（JSON数组）' AFTER `introduction`;

-- 2. 删除 course_recommendation 表中的 course_id 字段和相关的唯一索引
-- 注意：如果表中有数据，需要先备份或删除数据
-- 先删除唯一索引
ALTER TABLE `course_recommendation` 
DROP INDEX IF EXISTS `uk_course_id`;

-- 删除普通索引
ALTER TABLE `course_recommendation` 
DROP INDEX IF EXISTS `idx_course_id`;

-- 删除 course_id 字段
ALTER TABLE `course_recommendation` 
DROP COLUMN IF EXISTS `course_id`;

-- 3. 清空 course_recommendation 表（因为结构改变了）
TRUNCATE TABLE `course_recommendation`;

-- 4. 创建默认的公共配置数据（空数组）
INSERT INTO `course_recommendation` (`recommended_course_ids`, `create_time`, `update_time`) 
VALUES ('[]', NOW(), NOW())
ON DUPLICATE KEY UPDATE `update_time` = NOW();
