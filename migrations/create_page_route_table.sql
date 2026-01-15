-- 创建页面路由表
CREATE TABLE IF NOT EXISTS `page_route` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `path` varchar(500) NOT NULL COMMENT '页面路径（如：/pages/index/index）',
  `title` varchar(100) NOT NULL COMMENT '页面标题（如：首页）',
  `type` varchar(50) DEFAULT NULL COMMENT '页面类型（main-主包，sub-子包，tabBar-tabBar页面）',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态（0-禁用，1-启用）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_path` (`path`),
  KEY `idx_type` (`type`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序页面路由表';
