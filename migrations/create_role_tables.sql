-- 创建角色表
CREATE TABLE IF NOT EXISTS `sys_role` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `value` varchar(50) NOT NULL COMMENT '角色标识（如：agent, content_admin）',
  `name` varchar(50) NOT NULL COMMENT '角色名称（如：代理商、题库管理员）',
  `description` text COMMENT '角色描述',
  `is_system` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否系统角色（0-否，1-是），系统角色不能删除',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态（0-禁用，1-启用）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_value` (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统角色表';

-- 创建角色权限关联表
CREATE TABLE IF NOT EXISTS `sys_role_permission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `role_id` int(11) NOT NULL COMMENT '角色ID',
  `permission` varchar(100) NOT NULL COMMENT '权限标识（如：dashboard:view, question:create）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_role_id` (`role_id`),
  UNIQUE KEY `uk_role_permission` (`role_id`, `permission`),
  CONSTRAINT `fk_role_permission_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色权限关联表';

-- 为 sys_user 表添加 role_id 字段（如果不存在）
ALTER TABLE `sys_user` 
ADD COLUMN IF NOT EXISTS `role_id` int(11) NULL COMMENT '角色ID（关联 sys_role 表）' AFTER `role`;

-- 添加外键约束（可选，如果已有数据需要先处理）
-- ALTER TABLE `sys_user` 
-- ADD CONSTRAINT `fk_user_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`) ON DELETE SET NULL;
