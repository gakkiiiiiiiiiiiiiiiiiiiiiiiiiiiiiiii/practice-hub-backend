-- 微信小程序虚拟支付：保存用户态签名所需 session_key 与订单支付上下文
ALTER TABLE `app_user`
  ADD COLUMN `session_key` varchar(255) NULL AFTER `openid`;

ALTER TABLE `order`
  ADD COLUMN `pay_provider` varchar(30) NULL AFTER `course_id`;

ALTER TABLE `order`
  ADD COLUMN `pay_payload` json NULL AFTER `pay_provider`;

ALTER TABLE `order`
  ADD COLUMN `paid_time` datetime NULL AFTER `pay_payload`;
