# 课程 VIP 概念改为付费/免费 - 数据库迁移文档

## 概述
将课程表中的 `is_vip_free` 字段改为 `is_free`，将 VIP 概念改为付费/免费。

## 字段说明
- **旧字段**: `is_vip_free` (0-否, 1-是)
- **新字段**: `is_free` (0-付费, 1-免费)

## 迁移步骤

### 1. 备份数据库
```bash
# 在迁移前备份数据库
docker compose exec mysql mysqldump -u root -p practice_hub > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 2. 执行迁移 SQL
```bash
# 进入 MySQL 容器
docker compose exec mysql mysql -u root -p practice_hub

# 执行以下 SQL
ALTER TABLE course CHANGE COLUMN is_vip_free is_free TINYINT(1) DEFAULT 0 COMMENT '0-付费, 1-免费';
```

或者使用非交互式方式：
```bash
# 设置密码环境变量（避免警告）
export MYSQL_PWD=your_password

# 执行 SQL
docker compose exec mysql mysql -u root practice_hub -e "ALTER TABLE course CHANGE COLUMN is_vip_free is_free TINYINT(1) DEFAULT 0 COMMENT '0-付费, 1-免费';"
```

### 3. 验证迁移结果
```bash
docker compose exec mysql mysql -u root -p practice_hub -e "DESCRIBE course;"
```

应该看到 `is_free` 字段，而不是 `is_vip_free`。

### 4. 数据迁移（如果需要）
如果数据库中已有数据，且需要将旧的 VIP 免费逻辑转换为新的免费逻辑：
```sql
-- 查看当前数据
SELECT id, name, price, is_vip_free FROM course;

-- 如果 is_vip_free = 1，则 is_free = 1（免费）
-- 如果 is_vip_free = 0，则 is_free = 0（付费）
-- 注意：字段已经重命名，所以这个查询会失败，仅作为参考
```

## 回滚方案

如果需要回滚，执行：
```sql
ALTER TABLE course CHANGE COLUMN is_free is_vip_free TINYINT(1) DEFAULT 0 COMMENT '0-否, 1-是';
```

## 注意事项

1. **代码已更新**：后端和前端代码已经更新为使用 `is_free` 字段
2. **字段语义**：
   - `is_free = 0`：付费课程
   - `is_free = 1`：免费课程
3. **权限判断逻辑**：
   - 如果 `price = 0` 或 `is_free = 1`，则课程免费
   - 否则需要检查用户是否有购买权限

## 相关文件修改

### 后端
- `back-end/src/database/entities/course.entity.ts` - 实体定义
- `back-end/src/modules/admin-course/dto/create-course.dto.ts` - DTO
- `back-end/src/modules/admin-course/dto/update-course.dto.ts` - DTO
- `back-end/src/modules/course/course.service.ts` - 服务层
- `back-end/src/modules/question/question.service.ts` - 权限判断逻辑

### 前端（管理端）
- `admin-web/src/views/question/course/index.vue` - 课程列表
- `admin-web/src/views/question/course/components/CourseModal.vue` - 课程表单

### 前端（小程序）
- `font-end/pages/index/index.vue` - 首页课程列表
- `font-end/pages/bank/index.vue` - 题库页面
- `font-end/pages/sub-pages/course-intro/index.vue` - 课程介绍页
