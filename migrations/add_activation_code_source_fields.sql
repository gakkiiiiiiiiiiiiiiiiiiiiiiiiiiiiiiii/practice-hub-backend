-- 激活码来源与批次前缀记录
ALTER TABLE `activation_code`
  ADD COLUMN `source_type` varchar(30) NOT NULL DEFAULT 'admin' COMMENT '生成来源：admin/agent/distributor/app_admin' AFTER `agent_id`,
  ADD COLUMN `source_id` int NULL COMMENT '来源主体ID，如后台用户ID、分销商ID、小程序管理员用户ID' AFTER `source_type`,
  ADD COLUMN `batch_prefix` varchar(20) NULL COMMENT '批次号前缀，用于区分生成来源' AFTER `source_id`;

UPDATE `activation_code`
SET
  `batch_prefix` = CASE
    WHEN `batch_id` LIKE 'DST%' THEN 'DST'
    WHEN `batch_id` LIKE 'APP%' THEN 'APP'
    WHEN `batch_id` LIKE 'ADM%' THEN 'ADM'
    WHEN `batch_id` LIKE 'AGT%' THEN 'AGT'
    WHEN `batch_id` LIKE 'D%' THEN 'D'
    ELSE 'BATCH'
  END,
  `source_type` = CASE
    WHEN `batch_id` LIKE 'DST%' OR `batch_id` LIKE 'D%' THEN 'distributor'
    WHEN `batch_id` LIKE 'APP%' THEN 'app_admin'
    WHEN `agent_id` IS NOT NULL THEN 'agent'
    ELSE 'admin'
  END,
  `source_id` = CASE
    WHEN `agent_id` IS NOT NULL THEN `agent_id`
    ELSE `source_id`
  END;
