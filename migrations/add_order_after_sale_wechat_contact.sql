-- 售后申请增加微信联系方式
ALTER TABLE `order_after_sale`
  ADD COLUMN `wechat_contact` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '微信联系方式（微信号/手机号）' AFTER `description`;
