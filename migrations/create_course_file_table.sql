-- 课程多文件子表 + 阅读进度按文件隔离
-- 若线上已存在下列对象，请勿重复执行。

CREATE TABLE IF NOT EXISTS `course_file` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `course_id` INT NOT NULL,
  `display_name` VARCHAR(255) NOT NULL COMMENT '展示名称（可自定义）',
  `file_url` VARCHAR(500) NOT NULL,
  `file_name` VARCHAR(255) NULL,
  `file_type` VARCHAR(20) NOT NULL,
  `file_size` BIGINT NOT NULL DEFAULT 0,
  `sort` INT NOT NULL DEFAULT 0,
  `file_page_count` INT NULL DEFAULT NULL COMMENT 'PDF 总页数缓存',
  `file_page_count_key` VARCHAR(32) NULL DEFAULT NULL COMMENT '页数缓存对应的文件版本',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '0-禁用，1-启用',
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_course_file_course_sort` (`course_id`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件课程附件';

-- 历史单文件课程数据回填
INSERT INTO `course_file` (
  `course_id`,
  `display_name`,
  `file_url`,
  `file_name`,
  `file_type`,
  `file_size`,
  `sort`,
  `file_page_count`,
  `file_page_count_key`,
  `status`
)
SELECT
  c.`id`,
  COALESCE(NULLIF(TRIM(c.`file_name`), ''), c.`name`),
  c.`file_url`,
  c.`file_name`,
  LOWER(COALESCE(NULLIF(TRIM(c.`file_type`), ''), 'pdf')),
  COALESCE(c.`file_size`, 0),
  0,
  c.`file_page_count`,
  c.`file_page_count_key`,
  1
FROM `course` c
WHERE c.`content_type` = 'file'
  AND c.`file_url` IS NOT NULL
  AND TRIM(c.`file_url`) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `course_file` cf WHERE cf.`course_id` = c.`id` LIMIT 1
  );

-- 阅读进度：增加 course_file_id
ALTER TABLE `user_file_course_progress`
  ADD COLUMN `course_file_id` INT NULL DEFAULT NULL COMMENT '文件课程附件ID' AFTER `course_id`;

-- 将已有进度关联到各课程的首个文件
UPDATE `user_file_course_progress` p
INNER JOIN (
  SELECT cf.`course_id`, MIN(cf.`id`) AS `file_id`
  FROM `course_file` cf
  WHERE cf.`status` = 1
  GROUP BY cf.`course_id`
) first_file ON first_file.`course_id` = p.`course_id`
SET p.`course_file_id` = first_file.`file_id`
WHERE p.`course_file_id` IS NULL;

-- 替换唯一索引（线上可能是 uniq_user_file_course_progress 或 IDX_user_file_course_progress_user_course）
ALTER TABLE `user_file_course_progress`
  DROP INDEX `uniq_user_file_course_progress`;

-- 若上一句报 1091（索引不存在），再尝试：
-- ALTER TABLE `user_file_course_progress` DROP INDEX `IDX_user_file_course_progress_user_course`;

ALTER TABLE `user_file_course_progress`
  ADD UNIQUE KEY `IDX_user_file_course_progress_user_course_file` (`user_id`, `course_id`, `course_file_id`);
