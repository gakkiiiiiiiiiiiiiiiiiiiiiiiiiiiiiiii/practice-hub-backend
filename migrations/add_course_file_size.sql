-- 课程文件大小字段
-- 若线上已经存在 file_size 字段，请不要重复执行本文件。
ALTER TABLE `course`
  ADD COLUMN `file_size` BIGINT NOT NULL DEFAULT 0 COMMENT '文件课程：文件大小（字节）' AFTER `file_type`;
