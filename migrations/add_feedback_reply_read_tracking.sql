ALTER TABLE `feedback`
  ADD COLUMN `reply_time` DATETIME NULL COMMENT '管理员最近回复时间' AFTER `reply`,
  ADD COLUMN `reply_read_time` DATETIME NULL COMMENT '用户最近读取回复时间' AFTER `reply_time`;

UPDATE `feedback`
SET `reply_time` = `update_time`
WHERE `reply_time` IS NULL
  AND `reply` IS NOT NULL
  AND TRIM(`reply`) <> '';

ALTER TABLE `feedback`
  ADD INDEX `idx_feedback_user_unread_reply` (`user_id`, `reply_time`, `reply_read_time`);
