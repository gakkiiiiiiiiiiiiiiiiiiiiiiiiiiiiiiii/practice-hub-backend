-- 文件课程未购买试读页数：0 表示无预览，默认保持历史前三页试读。
-- 若线上已存在该字段，请勿重复执行。
ALTER TABLE `course`
  ADD COLUMN `trial_preview_page_count` INT NOT NULL DEFAULT 3 COMMENT '未购买试读页数，0表示无预览' AFTER `allow_source_file`;
