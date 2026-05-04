-- 小程序用户角色，admin 可在小程序端不受购买/分销限制生成激活码
ALTER TABLE `app_user`
  ADD COLUMN `role` varchar(20) NOT NULL DEFAULT 'user' COMMENT '小程序用户角色：user/admin' AFTER `phone`;
