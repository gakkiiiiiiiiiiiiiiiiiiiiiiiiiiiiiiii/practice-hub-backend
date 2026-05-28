-- 将 VIP 相关表名/字段名统一改为套餐（package）

RENAME TABLE `vip_section` TO `package_section`;
RENAME TABLE `vip_section_scope` TO `package_section_scope`;
RENAME TABLE `vip_plan` TO `package_plan`;
RENAME TABLE `user_vip_subscription` TO `user_package_subscription`;

UPDATE `order` SET `order_type` = 'package' WHERE `order_type` = 'vip';

ALTER TABLE `order`
  CHANGE COLUMN `vip_section_id` `package_section_id` INT NULL,
  CHANGE COLUMN `vip_plan_id` `package_plan_id` INT NULL;

ALTER TABLE `app_user`
  CHANGE COLUMN `vip_expire_time` `package_expire_time` DATETIME NULL;
