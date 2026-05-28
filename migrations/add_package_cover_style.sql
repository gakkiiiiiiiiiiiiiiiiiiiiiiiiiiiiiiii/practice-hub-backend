-- 套餐自动生成封面样式（背景色、字体色）

ALTER TABLE `package_section`
  ADD COLUMN `cover_style` JSON NULL COMMENT '自动生成封面样式' AFTER `cover_img`;
