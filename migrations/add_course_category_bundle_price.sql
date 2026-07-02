-- 增加课程分类整包购买价格
ALTER TABLE `course_category`
  ADD COLUMN `bundle_price` decimal(10,2) NOT NULL DEFAULT 30.00 COMMENT '整类课程购买价格（整数元）' AFTER `cover_img`;
