# 阿奇索拼多多激活码供货 API

这是运行在本项目阿里云服务器上的独立 Node.js 服务。它只提供 3 个公网 `POST` 接口：`/auth`、`/issue`、`/revoke`。服务使用独立进程和最小权限 MySQL 账号，不启动定时任务，也不会在空闲时访问对象存储或第三方 API。

## 接口域名

正式交付给阿奇索的地址应为已经完成 DNS、HTTPS 和真实请求验收的本项目阿里云域名：

```text
POST https://<本项目阿里云接口域名>/auth
POST https://<本项目阿里云接口域名>/issue
POST https://<本项目阿里云接口域名>/revoke
```

建议为该服务使用独立 HTTPS 子域名，Nginx 将以上 3 个路径反向代理到 `127.0.0.1:3101`。在域名和证书实际验证完成前，不要把占位地址交给阿奇索。

## 接口约定

所有请求和响应均为 `application/json`。`/issue` 与 `/revoke` 需要请求头：

```text
Authorization: Bearer <access_token>
```

成功响应统一为：

```json
{
  "success": true,
  "code": "OK",
  "data": {},
  "request_id": "..."
}
```

失败响应统一为：

```json
{
  "success": false,
  "code": "PRODUCT_NOT_FOUND",
  "message": "商品名未配置或尚未启用",
  "request_id": "..."
}
```

### 1. 鉴权

`POST /auth`

```json
{
  "client_id": "agiso-pdd",
  "client_secret": "由双方安全交换的高强度密钥"
}
```

成功时 `data`：

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 300
}
```

令牌默认 5 分钟有效，最长配置不超过 15 分钟。接口只返回通用的凭据错误，不区分账号不存在、密钥错误或账号禁用。

### 2. 按商品名发一枚激活码

`POST /issue`

```json
{
  "product_name": "高等数学基础 [C123]",
  "order_no": "PDD-ORDER-LINE-20260928-0001"
}
```

成功时 `data`：

```json
{
  "order_no": "PDD-ORDER-LINE-20260928-0001",
  "product_name": "高等数学基础 [C123]",
  "status": "issued",
  "activation_code": "AG0123456789ABCDEF0123456789ABCDEF",
  "supply_price": "20.00",
  "balance": "980.00",
  "issued_at": "2026-09-28T00:00:00.000Z",
  "revoked_at": null
}
```

商品名必须与商品映射表完全一致。服务不会根据课程名猜测、模糊匹配或自动选同名商品。系统生成的名称格式为：

- 课程：`课程名 [C<课程ID>]`
- 套餐：`套餐分区名 - 套餐方案名 [P<方案ID>]`
- 整类套餐：`父分类 / 分类名 [B<分类ID>]`

同一商户的 `order_no` 是唯一幂等键。同订单号、同商品名重试会返回首次生成的原激活码且不会再次扣款；同订单号换商品返回 `ORDER_CONFLICT`；已经撤销的订单不能重新发码。

### 3. 按原订单号撤销

`POST /revoke`

```json
{
  "order_no": "PDD-ORDER-LINE-20260928-0001"
}
```

成功时返回原订单，`status` 为 `revoked`，并返回原供货价和退款后的商户余额。重复撤销返回首次撤销结果，不会重复退款。

- 未核销的激活码直接作废并退回原供货价。
- 已核销课程码只撤销该码授予的权益；用户存在其他已支付订单或其他有效课程码时保留课程权限。
- 已核销整类套餐码按 `activation_code_id` 精确删除权益。
- 已核销套餐码从基线和剩余授予事件重算到期时间，从而保留其他订单或激活码的套餐时长。
- 已核销码缺少 `agiso_code_grant`、套餐基线或套餐事件时，返回 `ENTITLEMENT_INCONSISTENT`，整笔事务回滚，不作废、不撤权、不退款。

本接口只执行调用方请求的撤销，不自行查询或验证拼多多退款状态。调用方负责确保只在退款已确认后调用。

## 数据库初始化

先备份生产数据库，再执行：

```bash
mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USERNAME" -p "$DB_DATABASE" \
  < ../migrations/20260927_agiso_partner.sql
```

迁移仅建表，初始商户余额为 `0.00`；新同步商品的供货价为 `NULL` 且 `enabled=0`。迁移本身不会创建商户、充值、定价或启用商品。

生成商户密钥及其 PBKDF2 哈希：

```bash
npm run hash-secret
```

将 `client_secret_hash` 写入 `agiso_partner`。明文 `client_secret` 只安全交付一次，不能写入仓库、工单或普通日志。

### 同步商品目录

先只读预览系统将生成的唯一商品名：

```bash
node --env-file=.env scripts/sync-products.js
```

确认后写入或更新目录：

```bash
node --env-file=.env scripts/sync-products.js --apply
```

同步脚本只读取启用的付费课程、启用的付费套餐方案和启用的整类套餐。它不会复制小程序价格，不会覆盖已有 `supply_price` 或 `enabled`，也不会自动删除旧映射。管理员必须逐项填写独立供货价并显式启用后才能发码。

### 可审计充值

禁止直接 `UPDATE agiso_partner.balance`。充值必须通过本地管理命令写入余额流水：

```bash
node --env-file=.env scripts/topup.js --partner-id 1 --amount 1000.00 --ref BANK-20260928-0001
```

`--ref` 是银行流水号或其他唯一充值凭证。同商户、同凭证、同金额重试只返回首次结果；相同凭证但金额不同会拒绝。充值命令不暴露为公网接口。

## 运行与部署

```bash
cp .env.example .env
npm ci
npm test
node --env-file=.env src/server.js
```

生产环境用 systemd 或 Docker 运行，监听 `127.0.0.1:3101`，仅由 Nginx HTTPS 入口访问。2C2G 主机建议保留默认 6 个数据库连接。数据库账号应独立创建并仅授予本服务需要的表级权限；不得使用 MySQL root。

Nginx 示例：

```nginx
location = /auth {
    proxy_pass http://127.0.0.1:3101/auth;
    proxy_set_header X-Request-ID $request_id;
    proxy_set_header Host $host;
}
location = /issue {
    proxy_pass http://127.0.0.1:3101/issue;
    proxy_set_header X-Request-ID $request_id;
    proxy_set_header Host $host;
}
location = /revoke {
    proxy_pass http://127.0.0.1:3101/revoke;
    proxy_set_header X-Request-ID $request_id;
    proxy_set_header Host $host;
}
```

服务不提供第 4 个公网接口。健康检查可使用本机 TCP 连接和进程状态；不要把管理命令映射到 HTTP。

## 上线验收

定时器和全量扫描均不存在。上线按以下顺序执行：

1. 保持阿奇索自动采购关闭，部署迁移和服务。
2. 同步商品目录，手工配置一件测试商品的独立供货价并启用。
3. 用唯一凭证小额充值，核对 `agiso_partner.balance` 与 `agiso_balance_ledger`。
4. 手工验证鉴权、正常发码、相同订单号并发重试、同号换商品、余额不足。
5. 分别验证未核销撤销、已核销课程/类目/套餐撤销、套餐叠加后撤销及重复撤销。
6. 核对订单、激活码、余额流水、用户权益和服务日志后，再在阿奇索低流量启用。

阿奇索调用量为订单事件驱动。没有订单或撤销请求时，本服务不会扫描数据库、访问 OSS/CDN 或产生第三方 API 请求。
