-- 为课程增加一级/二级分类字段
ALTER TABLE `course`
  ADD COLUMN `category` VARCHAR(100) NULL COMMENT '一级分类' AFTER `subject`,
  ADD COLUMN `sub_category` VARCHAR(100) NULL COMMENT '二级分类' AFTER `category`;
