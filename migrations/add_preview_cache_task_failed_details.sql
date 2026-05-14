ALTER TABLE `preview_cache_task`
  ADD COLUMN `failed_details` LONGTEXT NULL COMMENT '失败明细(JSON)' AFTER `message`;

