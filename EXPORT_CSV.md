# 数据库导出为 CSV 格式

## 功能说明

此脚本可以将数据库中的所有表导出为 CSV 格式文件，方便数据备份、迁移和分析。

## 使用方法

### 1. 确保环境变量已配置

确保 `.env` 文件中配置了数据库连接信息：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=practice_hub
```

### 2. 运行导出脚本

```bash
cd back-end
npm run export:csv
```

或者直接使用 ts-node：

```bash
npx ts-node -r tsconfig-paths/register scripts/export-to-csv.ts
```

### 3. 查看导出结果

导出完成后，所有 CSV 文件会保存在 `back-end/exports/` 目录下：

```
back-end/exports/
├── sys_user.csv
├── app_user.csv
├── subject.csv
├── chapter.csv
├── question.csv
├── user_answer_log.csv
├── user_wrong_book.csv
├── user_collection.csv
├── user_subject_auth.csv
├── activation_code.csv
├── order.csv
├── sys_operation_log.csv
├── home_recommend_category.csv
├── home_recommend_item.csv
└── export_summary.txt
```

## 导出内容说明

### CSV 文件格式

- **编码**: UTF-8
- **分隔符**: 逗号 (`,`)
- **文本分隔符**: 双引号 (`"`)
- **换行符**: `\n`

### 特殊字段处理

1. **JSON 字段**（如 `options`, `answer`）
   - 自动转换为 JSON 字符串
   - 例如：`[{"label":"A","text":"选项A"}]`

2. **日期时间字段**
   - 格式化为 `YYYY-MM-DD HH:mm:ss`
   - 例如：`2024-12-22 12:00:00`

3. **NULL 值**
   - 显示为空字符串

4. **特殊字符**
   - 包含逗号、引号或换行符的值会自动用引号包裹
   - 引号会转义为双引号 (`""`)

### 导出摘要

脚本会在 `exports/export_summary.txt` 中生成导出摘要，包含：
- 导出时间
- 数据库名称
- 每个表的记录数和文件大小

## 导出的表列表

脚本会导出以下表：

1. `sys_user` - 后台管理员
2. `app_user` - 小程序用户
3. `subject` - 科目
4. `chapter` - 章节
5. `question` - 题目
6. `user_answer_log` - 答题记录
7. `user_wrong_book` - 错题本
8. `user_collection` - 收藏
9. `user_subject_auth` - 用户题库权限
10. `activation_code` - 激活码
11. `order` - 订单
12. `sys_operation_log` - 操作日志
13. `home_recommend_category` - 首页推荐分类
14. `home_recommend_item` - 首页推荐项

## 注意事项

1. **数据量较大时**
   - 导出可能需要一些时间
   - 确保有足够的磁盘空间

2. **数据库连接**
   - 确保数据库服务正在运行
   - 确保数据库连接信息正确

3. **权限问题**
   - 确保有读取所有表的权限
   - 如果某个表不存在，脚本会跳过并继续

4. **文件覆盖**
   - 每次运行会覆盖之前的导出文件
   - 如需保留历史版本，请手动备份

## 导入 CSV 到其他数据库

### MySQL

```sql
LOAD DATA INFILE '/path/to/file.csv'
INTO TABLE table_name
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS;
```

### PostgreSQL

```sql
COPY table_name FROM '/path/to/file.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', QUOTE '"');
```

### Excel

1. 打开 Excel
2. 数据 → 从文本/CSV
3. 选择 CSV 文件
4. 设置分隔符为逗号
5. 导入

## 故障排查

### 1. 连接失败

**错误**: `Unable to connect to the database`

**解决**:
- 检查 `.env` 文件中的数据库配置
- 确保数据库服务正在运行
- 检查数据库用户权限

### 2. 表不存在

**错误**: `表 xxx 不存在或为空，跳过`

**解决**:
- 这是正常的，如果表不存在会跳过
- 检查数据库是否已初始化

### 3. 权限不足

**错误**: `Access denied`

**解决**:
- 确保数据库用户有 SELECT 权限
- 检查是否有访问 INFORMATION_SCHEMA 的权限

### 4. 导出目录无法创建

**错误**: `EACCES: permission denied`

**解决**:
- 检查目录权限
- 尝试手动创建 `back-end/exports` 目录

## 示例输出

```
导出目录: /path/to/back-end/exports

数据库连接成功

正在导出表: sys_user...
  ✓ 已导出 5 条记录到 /path/to/back-end/exports/sys_user.csv
正在导出表: app_user...
  ✓ 已导出 100 条记录到 /path/to/back-end/exports/app_user.csv
...

导出摘要已保存到: /path/to/back-end/exports/export_summary.txt

✓ 所有表导出完成！

导出脚本执行完成
```

