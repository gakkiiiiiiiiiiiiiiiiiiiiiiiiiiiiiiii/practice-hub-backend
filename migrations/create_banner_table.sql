-- 创建轮播图表
CREATE TABLE IF NOT EXISTS `banner` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `image` varchar(500) NOT NULL COMMENT '轮播图图片URL',
  `link` varchar(500) DEFAULT NULL COMMENT '跳转链接（可选）',
  `title` varchar(100) DEFAULT NULL COMMENT '标题（可选）',
  `sort_order` int(11) NOT NULL DEFAULT '0' COMMENT '排序号，数字越小越靠前',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态（0-禁用，1-启用）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='轮播图表';
