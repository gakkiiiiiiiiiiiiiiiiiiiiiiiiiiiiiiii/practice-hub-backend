# 角色管理数据库迁移说明

## 概述

本次迁移将角色从枚举类型改为数据库表存储，支持动态创建角色和分配权限。

## 迁移步骤

### 1. 执行 SQL 脚本

```bash
# 进入后端容器
docker compose exec back-end bash

# 执行迁移脚本
mysql -h mysql -u root -p${MYSQL_ROOT_PASSWORD} ${MYSQL_DATABASE} < /app/migrations/create_role_tables.sql
```

或者使用 docker compose：

```bash
docker compose exec mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} ${MYSQL_DATABASE} < back-end/migrations/create_role_tables.sql
```

### 2. 验证迁移结果

```sql
-- 检查表是否创建成功
SHOW TABLES LIKE 'sys_role%';

-- 检查默认角色是否创建
SELECT * FROM sys_role;

-- 检查角色权限是否创建
SELECT r.name, rp.permission 
FROM sys_role r 
LEFT JOIN sys_role_permission rp ON r.id = rp.role_id 
ORDER BY r.id, rp.permission;
```

### 3. 更新现有用户

如果现有用户需要关联到角色表，可以执行：

```sql
-- 根据 role 枚举值更新 role_id
UPDATE sys_user su
INNER JOIN sys_role sr ON su.role = sr.value
SET su.role_id = sr.id
WHERE su.role_id IS NULL;
```

## 表结构说明

### sys_role（角色表）

- `id`: 主键
- `value`: 角色标识（唯一，如：agent, content_admin）
- `name`: 角色名称（如：代理商、题库管理员）
- `description`: 角色描述
- `is_system`: 是否系统角色（0-否，1-是），系统角色不能删除
- `status`: 状态（0-禁用，1-启用）
- `create_time`: 创建时间
- `update_time`: 更新时间

### sys_role_permission（角色权限关联表）

- `id`: 主键
- `role_id`: 角色ID（外键）
- `permission`: 权限标识（如：dashboard:view, question:create）
- `create_time`: 创建时间

## 默认角色

系统会自动创建以下默认角色：

1. **代理商** (`agent`)
   - 权限：仪表盘、激活码管理、资金记录

2. **题库管理员** (`content_admin`)
   - 权限：仪表盘、题目管理、课程管理、章节管理

3. **系统管理员** (`super_admin`)
   - 权限：所有权限
   - 系统角色，不能删除或修改权限

## 注意事项

1. `sys_user` 表的 `role` 字段保留用于兼容，实际使用 `role_id` 关联
2. 系统角色（`is_system = 1`）不能删除或修改权限
3. 删除角色前会检查是否有用户使用该角色
4. 权限验证优先从数据库读取，如果数据库中没有则使用硬编码权限（向后兼容）

## 回滚

如果需要回滚，可以执行：

```sql
-- 删除外键约束
ALTER TABLE sys_user DROP FOREIGN KEY IF EXISTS fk_user_role;
ALTER TABLE sys_role_permission DROP FOREIGN KEY IF EXISTS fk_role_permission_role;

-- 删除表
DROP TABLE IF EXISTS sys_role_permission;
DROP TABLE IF EXISTS sys_role;

-- 删除 sys_user 表的 role_id 字段
ALTER TABLE sys_user DROP COLUMN IF EXISTS role_id;
```
