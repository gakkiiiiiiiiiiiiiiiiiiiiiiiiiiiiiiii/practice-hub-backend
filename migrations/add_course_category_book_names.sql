-- 二级分类所属书本筛选项。为空时小程序端不展示“所属书本”筛选。
ALTER TABLE `course_category`
  ADD COLUMN `book_names` JSON NULL COMMENT '二级分类所属书本筛选项' AFTER `bundle_enabled`;
