# 反馈表管理员支持迁移指南

## 迁移目的

更新 `feedback` 表结构，支持管理员提交反馈功能。管理员提交的反馈使用 `user_id = 0` 来标识。

## 迁移内容

1. **删除外键约束**：移除 `feedback.user_id` 对 `app_user.id` 的外键约束
2. **修改字段属性**：将 `user_id` 字段改为可空（nullable）
3. **添加注释**：为 `user_id` 字段添加注释说明

## 执行步骤

### ⚠️ 重要：执行前必须备份！

```bash
# 备份数据库（交互式输入密码，避免警告）
mysqldump -h localhost -u root -p practice_hub > backup_before_feedback_migration_$(date +%Y%m%d_%H%M%S).sql

# 如果使用 Docker Compose（推荐）
# 注意：Docker 容器内使用密码是安全的，警告可以忽略
cd back-end
docker compose exec -T mysql mysqldump -uroot -proot123456 practice_hub > backup_before_feedback_migration_$(date +%Y%m%d_%H%M%S).sql 2>/dev/null

# 或者使用环境变量（避免警告）
docker compose exec -T mysql sh -c 'MYSQL_PWD=root123456 mysqldump -uroot practice_hub' > backup_before_feedback_migration_$(date +%Y%m%d_%H%M%S).sql

# 或者使用容器名（如果容器名是 back-end）
docker exec back-end mysqldump -uroot -proot123456 practice_hub > backup_before_feedback_migration_$(date +%Y%m%d_%H%M%S).sql 2>/dev/null
```

### 执行迁移

```bash
# 方法1：使用 MySQL 命令行（交互式输入密码，避免警告）
cd back-end
mysql -h localhost -u root -p practice_hub < migrations/update_feedback_for_admin.sql

# 方法2：使用 Docker Compose（推荐，警告可以忽略）
cd back-end
docker compose exec -T mysql mysql -uroot -proot123456 practice_hub < migrations/update_feedback_for_admin.sql 2>/dev/null

# 方法3：使用环境变量（避免警告）
cd back-end
docker compose exec -T mysql sh -c 'MYSQL_PWD=root123456 mysql -uroot practice_hub' < migrations/update_feedback_for_admin.sql

# 方法4：使用容器名（如果容器名是 back-end）
cd back-end
docker exec -i back-end mysql -uroot -proot123456 practice_hub < migrations/update_feedback_for_admin.sql 2>/dev/null

# 方法5：先复制文件到容器再执行（适用于容器内执行）
cd back-end
docker compose cp migrations/update_feedback_for_admin.sql mysql:/tmp/
docker compose exec mysql sh -c 'MYSQL_PWD=root123456 mysql -uroot practice_hub -e "source /tmp/update_feedback_for_admin.sql"'

# 方法6：在 MySQL 命令行中交互式执行
cd back-end
docker compose exec mysql mysql -uroot -proot123456 practice_hub
# 然后在 MySQL 命令行中执行：
# source /tmp/update_feedback_for_admin.sql;
```

### 验证迁移结果

```sql
-- 1. 检查 user_id 字段是否可空
SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_COMMENT 
FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
AND TABLE_NAME = 'feedback' 
AND COLUMN_NAME = 'user_id';

-- 应该看到：
-- IS_NULLABLE: YES
-- COLUMN_COMMENT: 用户ID，0表示管理员提交的反馈

-- 2. 检查外键约束是否已删除
SELECT 
    CONSTRAINT_NAME,
    TABLE_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = 'feedback'
AND COLUMN_NAME = 'user_id'
AND REFERENCED_TABLE_NAME IS NOT NULL;

-- 应该返回空结果（没有外键约束）

-- 3. 测试插入管理员反馈（user_id = 0）
INSERT INTO feedback (user_id, type, description, status) 
VALUES (0, 'bug', '测试管理员反馈', 'pending');

-- 4. 检查插入的数据
SELECT * FROM feedback WHERE user_id = 0;

-- 5. 清理测试数据
DELETE FROM feedback WHERE user_id = 0 AND description = '测试管理员反馈';
```

## 回滚方案

如果需要回滚，可以执行以下 SQL：

```sql
-- 1. 修改 user_id 字段为不可空
ALTER TABLE `feedback` 
  MODIFY COLUMN `user_id` INT NOT NULL COMMENT '用户ID';

-- 2. 删除 user_id = 0 的记录（如果有）
DELETE FROM feedback WHERE user_id = 0;

-- 3. 重新添加外键约束（可选）
ALTER TABLE `feedback`
  ADD CONSTRAINT `fk_feedback_user` 
  FOREIGN KEY (`user_id`) 
  REFERENCES `app_user` (`id`) 
  ON DELETE CASCADE;
```

## 常见问题

### 1. MySQL 密码警告

**警告信息**：
```
mysql: [Warning] Using a password on the command line interface can be insecure.
```

**解决方案**：

#### 方案一：忽略警告（推荐，适用于 Docker 环境）
在 Docker 容器环境中，这个警告可以安全忽略，因为容器是隔离的。可以使用 `2>/dev/null` 重定向警告信息：

```bash
docker compose exec -T mysql mysql -uroot -proot123456 practice_hub < migrations/update_feedback_for_admin.sql 2>/dev/null
```

#### 方案二：使用环境变量（避免警告）
```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD=root123456 mysql -uroot practice_hub' < migrations/update_feedback_for_admin.sql
```

#### 方案三：交互式输入密码（最安全）
```bash
# 不使用 -p 参数，MySQL 会提示输入密码
mysql -h localhost -u root practice_hub < migrations/update_feedback_for_admin.sql
```

#### 方案四：使用 MySQL 配置文件
创建 `~/.my.cnf` 文件：
```ini
[client]
user=root
password=root123456
host=localhost
```

然后执行：
```bash
mysql practice_hub < migrations/update_feedback_for_admin.sql
```

### 2. 外键约束删除失败

如果外键约束名称不同，可以手动查找并删除：

```sql
-- 查找外键约束名称
SELECT CONSTRAINT_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME = 'feedback'
AND COLUMN_NAME = 'user_id'
AND REFERENCED_TABLE_NAME IS NOT NULL;

-- 删除外键约束（替换 CONSTRAINT_NAME）
ALTER TABLE `feedback` DROP FOREIGN KEY `CONSTRAINT_NAME`;
```

### 2. 迁移后现有数据受影响吗？

不会。迁移只是修改了字段属性，不会影响现有数据。现有的反馈记录仍然保持原有的 `user_id` 值。

### 3. 如何区分管理员和普通用户的反馈？

- 管理员提交的反馈：`user_id = 0`
- 普通用户提交的反馈：`user_id > 0` 且关联 `app_user` 表

在查询时，可以通过以下方式区分：

```sql
-- 查询所有反馈，包括管理员提交的
SELECT 
    id,
    user_id,
    CASE 
        WHEN user_id = 0 THEN '管理员'
        ELSE user.nickname
    END AS submitter,
    type,
    description,
    status
FROM feedback
LEFT JOIN app_user user ON feedback.user_id = user.id;
```

## 注意事项

1. ⚠️ **执行前务必备份数据库**
2. ⚠️ **在生产环境执行前，请在测试环境先验证**
3. ⚠️ **迁移后，管理员提交的反馈 `user_id` 为 0，不会关联 `app_user` 表**
4. ⚠️ **如果需要外键约束来保证数据完整性，可以考虑创建 ID 为 0 的系统用户记录**

