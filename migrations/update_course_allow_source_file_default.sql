ALTER TABLE `course`
  MODIFY COLUMN `allow_source_file` TINYINT NOT NULL DEFAULT 0 COMMENT '是否允许查看源文件：0-否，1-是';
