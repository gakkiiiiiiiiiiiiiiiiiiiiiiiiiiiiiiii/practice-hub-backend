-- 创建课程相关推荐表
CREATE TABLE IF NOT EXISTS `course_recommendation` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `course_id` int(11) DEFAULT NULL COMMENT '课程ID，null表示公共配置',
  `recommended_course_ids` json NOT NULL COMMENT '推荐课程ID列表（JSON数组）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_course_id` (`course_id`),
  KEY `idx_course_id` (`course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='课程相关推荐配置表';
