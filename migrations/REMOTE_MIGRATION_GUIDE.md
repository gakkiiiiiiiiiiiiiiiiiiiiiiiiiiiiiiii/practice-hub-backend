# 远程数据库迁移指南

## 问题说明

在将本地数据库导入到远程数据库时，如果远程数据库还是旧结构（使用 `subject` 和 `subject_id`），而本地数据库已经迁移到新结构（使用 `course` 和 `course_id`），会导致导入失败。

## 解决方案

### 方案一：先迁移远程数据库，再导入数据（推荐）

1. **在远程服务器上执行迁移**

   如果远程服务器有代码：
   ```bash
   cd back-end
   npm run migrate
   ```

   或者直接连接远程数据库执行 SQL：
   ```bash
   # 连接远程数据库
   mysql -h <远程地址> -P <端口> -u <用户名> -p<密码> practice_hub
   
   # 执行迁移脚本
   source migrations/migrate_subject_to_course.sql;
   ```

2. **然后执行导入**
   ```bash
   npm run import:remote
   ```

### 方案二：使用智能迁移脚本

1. **在远程服务器上执行智能迁移**
   ```bash
   cd back-end
   npm run migrate
   ```

   智能迁移脚本会自动检测数据库状态，只执行必要的迁移操作。

2. **然后执行导入**
   ```bash
   npm run import:remote
   ```

### 方案三：手动修复特定表

如果只需要修复 `home_recommend_item` 表：

```sql
-- 连接远程数据库后执行
ALTER TABLE `home_recommend_item` 
CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';
```

或者使用修复脚本：
```bash
npm run fix:home-recommend
```

## 检查数据库结构

在导入前，可以检查远程数据库结构：

```sql
-- 检查表是否存在
SHOW TABLES LIKE 'course';
SHOW TABLES LIKE 'subject';

-- 检查字段
SELECT COLUMN_NAME 
FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = 'practice_hub' 
AND TABLE_NAME = 'home_recommend_item' 
AND COLUMN_NAME IN ('subject_id', 'course_id');
```

## 常见错误

### 错误：Unknown column 'course_id' in 'field list'

**原因**：远程数据库表还在使用 `subject_id`，但导入的 SQL 使用了 `course_id`。

**解决**：
1. 先执行迁移脚本更新远程数据库结构
2. 或者手动执行 SQL 更新字段名

### 错误：Table 'practice_hub.subject' doesn't exist

**原因**：本地数据库已经迁移，`subject` 表已重命名为 `course`。

**解决**：这是正常的，导入脚本已经更新为导出 `course` 表。

## 迁移检查清单

- [ ] 远程数据库已执行迁移（`subject` -> `course`）
- [ ] 远程数据库字段已更新（`subject_id` -> `course_id`）
- [ ] 所有相关表都已更新：
  - [ ] `chapter` 表
  - [ ] `user_course_auth` 表（原 `user_subject_auth`）
  - [ ] `user_wrong_book` 表
  - [ ] `order` 表
  - [ ] `activation_code` 表
  - [ ] `home_recommend_item` 表

## 快速修复命令

如果需要快速修复远程数据库的 `home_recommend_item` 表：

```bash
# 在远程服务器上
cd back-end
npm run fix:home-recommend
```

或者直接执行 SQL：

```sql
ALTER TABLE `home_recommend_item` 
CHANGE `subject_id` `course_id` INT NOT NULL COMMENT '课程ID';
```

