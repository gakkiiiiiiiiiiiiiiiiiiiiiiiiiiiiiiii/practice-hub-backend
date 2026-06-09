-- 功能反馈增加微信联系方式（选填）
ALTER TABLE `feedback`
  ADD COLUMN `wechat_contact` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '微信联系方式（微信号/手机号，选填）' AFTER `description`;
