# MySQL 连接问题修复指南

## 问题描述

错误：`Access denied for user 'root'@'192.168.65.1' (using password: YES)`

## 解决方案

### 方案一：更新 root 用户权限（推荐）

在 MySQL 容器中执行：

```bash
docker exec practice_hub_mysql mysql -u root -proot123456 -e "
ALTER USER 'root'@'%' IDENTIFIED BY 'root123456';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
"
```

### 方案二：使用普通用户（更安全）

1. 使用 docker-compose.yml 中创建的普通用户：
   - 用户名：`practice_user`
   - 密码：`practice_pass`

2. 修改 `.env` 文件：
   ```env
   DB_USERNAME=practice_user
   DB_PASSWORD=practice_pass
   ```

3. 确保普通用户有权限：
   ```bash
   docker exec practice_hub_mysql mysql -u root -proot123456 -e "
   GRANT ALL PRIVILEGES ON practice_hub.* TO 'practice_user'@'%';
   FLUSH PRIVILEGES;
   "
   ```

### 方案三：检查容器网络

如果使用 Docker Desktop，确保：
1. 容器正在运行：`docker compose ps`
2. 端口映射正确：`0.0.0.0:3306->3306/tcp`
3. 防火墙没有阻止连接

### 方案四：重启容器

```bash
cd back-end
docker compose restart mysql
# 等待几秒让 MySQL 完全启动
sleep 5
# 然后重新启动应用
```

## 验证连接

```bash
# 测试连接（使用 Docker 内部）
docker exec practice_hub_mysql mysql -u root -proot123456 -e "SELECT 1;"

# 测试连接（从外部）
# 注意：如果本地安装了 MySQL 9.0，可能不支持 mysql_native_password
# 建议使用 Docker 内部测试
```

## 常见问题

### 1. 认证插件不匹配

MySQL 8.0 默认使用 `caching_sha2_password`，但某些客户端可能不支持。

**解决**：确保 TypeORM 使用正确的连接参数，或使用 `mysql_native_password`。

### 2. IP 地址限制

如果 root 用户只允许从 `localhost` 连接，需要添加 `%` 权限。

### 3. 密码错误

确保 `.env` 文件中的密码与 `docker-compose.yml` 中的一致：
- docker-compose.yml: `MYSQL_ROOT_PASSWORD: root123456`
- .env: `DB_PASSWORD=root123456`

## 快速修复命令

```bash
cd back-end

# 1. 确保容器运行
docker compose ps

# 2. 更新 root 用户权限
docker exec practice_hub_mysql mysql -u root -proot123456 -e "
ALTER USER 'root'@'%' IDENTIFIED BY 'root123456';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
"

# 3. 验证配置
cat .env | grep DB_

# 4. 重启应用
npm run start:dev
```

