-- 为 user_answer_log 表添加 chapter_id 字段
-- 这个字段是冗余字段，用于方便按章节查询答题记录

-- 检查并添加 chapter_id 字段
ALTER TABLE `user_answer_log`
  ADD COLUMN IF NOT EXISTS `chapter_id` INT NOT NULL COMMENT '章节ID（冗余字段，便于查询）' AFTER `question_id`;

-- 如果表中已有数据，需要更新现有记录的 chapter_id
-- 通过 question_id 关联 question 表获取 chapter_id
UPDATE `user_answer_log` ual
INNER JOIN `question` q ON ual.question_id = q.id
SET ual.chapter_id = q.chapter_id
WHERE ual.chapter_id = 0 OR ual.chapter_id IS NULL;

