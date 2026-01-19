-- 为课程表添加有效期天数字段
-- 用于设置付费课程的有效期，null 表示永久有效

ALTER TABLE `course` 
ADD COLUMN `validity_days` INT NULL COMMENT '有效期天数，null表示永久有效' AFTER `is_free`;

-- 为现有付费课程设置默认值为永久有效（null）
-- 免费课程保持 null 即可
