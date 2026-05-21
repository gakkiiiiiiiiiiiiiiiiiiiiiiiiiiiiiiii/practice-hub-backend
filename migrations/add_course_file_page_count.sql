-- 文件课程 PDF 总页数缓存（与 file_url 版本绑定，避免 preview-pages-info 每次解析源文件）
-- 若线上已存在下列字段，请勿重复执行。
ALTER TABLE `course`
  ADD COLUMN `file_page_count` INT NULL DEFAULT NULL COMMENT '文件课程：PDF 总页数缓存' AFTER `file_size`,
  ADD COLUMN `file_page_count_key` VARCHAR(32) NULL DEFAULT NULL COMMENT '文件课程：页数缓存对应的文件版本' AFTER `file_page_count`;
