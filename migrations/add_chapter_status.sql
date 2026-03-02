-- 为章节表添加 status 字段（与 Chapter 实体一致）
-- 状态：0-禁用，1-启用，默认 1

ALTER TABLE `chapter`
ADD COLUMN `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-禁用，1-启用' AFTER `sort`;
