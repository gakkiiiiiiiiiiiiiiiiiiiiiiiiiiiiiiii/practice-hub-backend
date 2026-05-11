-- 首页推荐板块：小程序端每行显示列数
-- 若线上已经存在 columns 字段，请不要重复执行本文件。
ALTER TABLE `home_recommend_category`
  ADD COLUMN `columns` INT NOT NULL DEFAULT 3 COMMENT '小程序端每行显示列数' AFTER `sort`;

UPDATE `home_recommend_category`
SET `columns` = 3
WHERE `columns` IS NULL OR `columns` < 1 OR `columns` > 4;
