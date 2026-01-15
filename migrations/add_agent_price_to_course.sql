-- 添加代理商售价字段
ALTER TABLE `course`
ADD COLUMN `agent_price` DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER `price`;
