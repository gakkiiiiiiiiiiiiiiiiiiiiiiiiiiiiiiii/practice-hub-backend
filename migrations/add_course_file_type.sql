-- 课程表增加文件类型课程字段（PDF/Word 作为课程内容）
ALTER TABLE `course`
  ADD COLUMN `content_type` varchar(20) NOT NULL DEFAULT 'normal' COMMENT '课程内容类型：normal=普通题库，file=文件课程' AFTER `introduction`,
  ADD COLUMN `file_url` varchar(500) DEFAULT NULL COMMENT '文件课程：文件URL' AFTER `content_type`,
  ADD COLUMN `file_name` varchar(255) DEFAULT NULL COMMENT '文件课程：文件名称' AFTER `file_url`,
  ADD COLUMN `file_type` varchar(20) DEFAULT NULL COMMENT '文件课程：文件类型 pdf/doc/docx' AFTER `file_name`;
