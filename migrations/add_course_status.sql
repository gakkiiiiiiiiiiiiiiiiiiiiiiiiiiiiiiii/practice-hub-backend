-- 为课程表添加 status 字段（与 Course 实体一致）
-- 状态：0-禁用，1-启用，默认 1

ALTER TABLE `course`
ADD COLUMN `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态：0-禁用，1-启用' AFTER `sort`;
