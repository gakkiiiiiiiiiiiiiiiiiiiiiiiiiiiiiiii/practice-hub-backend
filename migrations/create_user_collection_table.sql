-- ============================================
-- 创建 user_collection 表（如果不存在）
-- ============================================

CREATE TABLE IF NOT EXISTS `user_collection` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `question_id` INT NOT NULL COMMENT '题目ID',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_question` (`user_id`, `question_id`) COMMENT '用户和题目的唯一索引，防止重复收藏',
  KEY `idx_user_id` (`user_id`) COMMENT '用户ID索引',
  KEY `idx_question_id` (`question_id`) COMMENT '题目ID索引',
  KEY `idx_create_time` (`create_time`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户收藏表';

