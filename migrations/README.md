# 数据库迁移指南

## 迁移脚本说明

### 1. `migrate_subject_to_course.sql`
将数据库从 `subject` 结构迁移到 `course` 结构，包括：
- 重命名 `subject` 表为 `course`
- 添加新字段：`subject`、`school`、`major`、`exam_year`、`answer_year`
- 将所有相关表的 `subject_id` 字段改为 `course_id`

### 2. `rollback_course_to_subject.sql`
回滚脚本，将 `course` 结构回滚到 `subject` 结构（谨慎使用）

## 执行迁移的方法

### 方法一：使用 MySQL 命令行（推荐）

#### 1. 连接到数据库

**如果使用 Docker Compose：**
```bash
# 进入 MySQL 容器
docker exec -it practice-hub-mysql mysql -uroot -proot123456 practice_hub

# 或者直接执行 SQL 文件
docker exec -i practice-hub-mysql mysql -uroot -proot123456 practice_hub < migrations/migrate_subject_to_course.sql
```

**如果使用本地 MySQL：**
```bash
# 连接到数据库
mysql -h localhost -u root -p practice_hub

# 或者直接执行 SQL 文件
mysql -h localhost -u root -p practice_hub < migrations/migrate_subject_to_course.sql
```

#### 2. 在 MySQL 命令行中执行

```sql
-- 先备份数据库（重要！）
-- 在命令行执行：
-- mysqldump -u root -p practice_hub > backup_$(date +%Y%m%d_%H%M%S).sql

-- 然后执行迁移脚本
source migrations/migrate_subject_to_course.sql;

-- 或者直接复制粘贴 SQL 内容执行
```

### 方法二：使用数据库管理工具

#### Navicat / DBeaver / phpMyAdmin

1. **备份数据库**
   - 在工具中选择数据库
   - 导出/备份整个数据库

2. **执行 SQL 脚本**
   - 打开 SQL 编辑器
   - 打开 `migrate_subject_to_course.sql` 文件
   - 执行脚本

3. **验证结果**
   ```sql
   -- 检查表是否存在
   SHOW TABLES LIKE 'course';
   SHOW TABLES LIKE 'user_course_auth';
   
   -- 检查字段是否正确
   DESCRIBE course;
   DESCRIBE chapter;
   ```

### 方法三：使用 Node.js 脚本执行

创建一个执行脚本：

```bash
# 在 back-end 目录下执行
node scripts/run-migration.js
```

## 执行步骤

### ⚠️ 重要：执行前必须备份！

```bash
# 备份数据库
mysqldump -h localhost -u root -p practice_hub > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql

# 如果使用 Docker
docker exec practice-hub-mysql mysqldump -uroot -proot123456 practice_hub > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql
```

### 执行迁移

```bash
# 方法1：使用 MySQL 命令行
cd back-end
mysql -h localhost -u root -p practice_hub < migrations/migrate_subject_to_course.sql

# 方法2：使用 Docker
cd back-end
docker exec -i practice-hub-mysql mysql -uroot -proot123456 practice_hub < migrations/migrate_subject_to_course.sql
```

### 验证迁移结果

```sql
-- 1. 检查表是否重命名成功
SHOW TABLES;

-- 应该看到：
-- course (原 subject)
-- user_course_auth (原 user_subject_auth)

-- 2. 检查新字段是否添加成功
DESCRIBE course;

-- 应该看到新字段：
-- subject, school, major, exam_year, answer_year

-- 3. 检查外键字段是否更新
DESCRIBE chapter;
-- 应该看到 course_id (原 subject_id)

-- 4. 检查数据是否完整
SELECT COUNT(*) FROM course;
SELECT COUNT(*) FROM chapter;
SELECT COUNT(*) FROM user_course_auth;
```

## 常见问题

### 1. 如果迁移失败怎么办？

```bash
# 恢复备份
mysql -h localhost -u root -p practice_hub < backup_before_migration_YYYYMMDD_HHMMSS.sql
```

### 2. 如果表不存在怎么办？

如果 `subject` 表不存在，说明数据库可能是新建的，可以直接创建新表结构，不需要迁移。

### 3. 如何检查迁移是否成功？

执行以下 SQL 检查：

```sql
-- 检查所有相关表
SHOW TABLES;

-- 检查 course 表结构
DESCRIBE course;

-- 检查数据完整性
SELECT 
  (SELECT COUNT(*) FROM course) as course_count,
  (SELECT COUNT(*) FROM chapter) as chapter_count,
  (SELECT COUNT(*) FROM user_course_auth) as auth_count;
```

## 注意事项

1. ⚠️ **执行前务必备份数据库**
2. ⚠️ **在生产环境执行前，先在测试环境验证**
3. ⚠️ **确保应用已停止或处于维护模式**
4. ✅ **迁移完成后，重启后端服务**
5. ✅ **验证应用功能是否正常**

