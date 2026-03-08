-- 为题目表添加 sort_order 字段（与 Question 实体一致）
-- 用于拖拽排序，默认 0

ALTER TABLE `question`
ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0 COMMENT '序号，用于拖拽排序' AFTER `difficulty`;
