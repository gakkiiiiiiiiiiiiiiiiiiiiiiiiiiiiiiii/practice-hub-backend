ALTER TABLE `distribution_config`
  ADD COLUMN `promotion_poster_url` VARCHAR(500) NULL
  COMMENT '代理推广海报背景图URL'
  AFTER `description`;
