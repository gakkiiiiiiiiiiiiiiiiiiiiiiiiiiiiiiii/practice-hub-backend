ALTER TABLE course_file
  ADD COLUMN full_preview_requested TINYINT NOT NULL DEFAULT 0
  COMMENT '是否需要生成完整预览图片'
  AFTER file_page_count_key;
