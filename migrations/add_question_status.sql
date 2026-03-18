-- 试题表增加启用/禁用状态：1=启用，0=禁用
ALTER TABLE `question` ADD COLUMN `status` tinyint NOT NULL DEFAULT 1 COMMENT '1=启用，0=禁用';
