-- 为 user_answer_log 表添加缺失的字段
-- 这些字段用于支持简答题（文本答案和图片答案）

-- 检查并添加 text_answer 字段
ALTER TABLE `user_answer_log`
  ADD COLUMN IF NOT EXISTS `text_answer` TEXT NULL COMMENT '文本答案（简答题）' AFTER `user_option`;

-- 检查并添加 image_answer 字段
ALTER TABLE `user_answer_log`
  ADD COLUMN IF NOT EXISTS `image_answer` TEXT NULL COMMENT '图片答案URL（简答题）' AFTER `text_answer`;

-- 检查并添加 is_correct 字段（如果不存在）
ALTER TABLE `user_answer_log`
  ADD COLUMN IF NOT EXISTS `is_correct` TINYINT NULL COMMENT '0-错误, 1-正确, null-待批改（简答题）' AFTER `image_answer`;

