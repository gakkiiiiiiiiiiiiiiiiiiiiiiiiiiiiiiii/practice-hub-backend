# 管理端支付账单（按需、私有缓存）

## 范围与当前证据

- 普通微信支付：使用既有云托管支付代理 `POST http://api.weixin.qq.com/_/pay/downloadbill`，`bill_date` 为 yyyyMMdd、`bill_type=ALL`、`sub_mch_id` 来自明确环境配置。**尚未在真实云托管环境验证该账户的代理下载权限/响应格式；必须完成小批量云端验收才能宣称该通道上线可用。** 本地开发机不应模拟或绕过云托管身份。
- 虚拟支付：`POST https://api.weixin.qq.com/xpay/download_bill`，HMAC 签名的 body 使用数字 `begin_ds/end_ds` 和 `env`。已用一个有交易日实际验证：生成中返回 `268490011`，再次手动请求返回 `url/total_cnt`。下载是 XLSX **每日结算汇总**，不是逐笔流水。
- 2026-09-03 已通过本次实际 `PaymentBillGateway + XpayService + parseBill` 代码拉取 2026-08-31 虚拟支付账单：`ready`、5702 bytes、XLSX、预览支持、11列、1条汇总记录；原文哈希与此前独立平台下载完全相同。未提交真实账单或访问凭证。
- 实测 XLSX 表头：出库日期、交易笔数、交易金额、昨日交易笔数、昨日交易金额、退款笔数、技术服务费、平台回退金额、退款金额、结算金额、CPS服务费。`total_cnt`/记录行数不是交易笔数。金额只保留平台原值，单位尚未独立核验，不自动转换或合计收入。
- 普通账单可按明确商户订单号/微信订单号匹配现存订单字段。虚拟支付汇总没有逐笔订单标识，因此不做伪造订单关联；虚拟币充值与消费不能重复计作现金收入。
- 不调用扣款、退款、发货或订单状态变更接口。没有新增定时任务；不自动轮询、不自动补历史、不创建收费资源。

微信支付普通账单规则参考：[申请交易账单](https://pay.wechatpay.cn/doc/v3/merchant/4013071227)。代理接口和虚拟支付账户能力仍以小批量实测为验收依据，不能把第三方 SDK 当官方保证。

## 权限与 API

所有接口均要求 JWT、`role=super_admin`，且身份 `type=admin`、有效 `adminId`。小程序同名超级管理员身份不能访问。预览和下载审计写入 `sys_operation_log`，审计写入失败时拒绝曝光内容。拉取由现有全局操作日志记录。

| 接口                                                                   | 行为                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/admin/payment-bills?channel&startDate&endDate&page&pageSize` | 返回 `{list,total,page,pageSize}`，仅当前配置账户的元数据                                  |
| `POST /api/admin/payment-bills/fetch`                                  | `{channel:"wechat"或"xpay",billDate:"YYYY-MM-DD"}`；单日期单通道、同步等待一次申请/下载    |
| `GET /api/admin/payment-bills/:id/preview?page&pageSize`               | `{columns,rows,total,page,pageSize,previewSupported,notice}`，每行 `{cells,matchedOrders}` |
| `GET /api/admin/payment-bills/:id/download?format=original或xlsx`      | 原文或字符串化 Excel 附件，不暴露签名 URL                                                  |

业务响应沿用 `{code,msg,data}`。元数据包含 `id/channel/billDate/status/rowCount/originalSize/fetchedAt/retryAfter/errorMessage/previewSupported/notice/sha256/filename/contentType/summary`。预览最多100行/页；列表与日期通过 DTO 校验。API 设置 `Cache-Control: no-store`，文件设置附件下载和 `nosniff`。

`matchedOrders` 仅代表标识匹配，并非金额对账通过。`matchType` 是 `business_order / wechat_transaction / coin_recharge / coin_consumption`，不自动修改订单、充值或账务。

## 缓存、状态与资源约束

- 原文压缩为 gzip 保存在数据库 `LONGBLOB`；gzip **不是加密**。该内容不接入公开上传服务、OSS 公共桶或 CDN。数据库及备份的访问控制/静态加密由现有基础设施提供。列表查询默认不选择原文列。
- 唯一键 `(account_key,channel,bill_date)`，`account_key` 是账户身份 SHA-256，而非秘密凭证。原文另存 SHA-256；每次读取验证解压大小与哈希。
- 状态：`fetching / pending / ready / empty / failed`。`ready` 可以是仅原文可用；未知格式必须 `previewSupported=false`，不提供错误预览或 Excel。空响应/未知错误绝不当作有效空账单。
- 请求日期限制为过去89天已结束日期；昨日账单北京时间10:00前拒绝。明确 `empty` 缓存6小时，然后允许手动再查，避免延迟出账被永久掩盖。
- `ready` 缓存永久复用，缓存命中零平台请求；`pending` 60秒后手动重试，失败指数退避1分钟至1小时。没有任何轮询或定时器。
- 持久化全局控制行使用事务/行锁：跨进程并发最多1个拉取、租约120秒、每天最多40个拉取动作、单账户日账单每天最多12次。进程退出时租约自然过期；过期持有者不能覆盖新任务结果。
- 账单 token getter 独立单次请求、复用既有缓存，不改变支付接口的重试策略。最多 token 15秒 + Xpay 20秒 + 文件 GET 20秒，总外部等待不超过55秒；不重定向、不自动重试。
- 下载只接受 HTTPS 精确允许域名：`api.weixin.qq.com`、`api.mch.weixin.qq.com`、以及本次官方 Xpay 响应实际返回的 `mmbizwxaintpcos-1258344707.cos.ap-shanghai.myqcloud.com`。禁止 IP、user info、非443端口、hash、通配云桶和重定向。新增下载域名必须先核验官方来源再代码变更。
- 文件原始最大10 MiB。ZIP 中央目录最多200 entries，实际总解压最多10 MiB；先校验中央/本地文件名及压缩参数一致、限制实际 inflate 输出、拒绝 ZIP64/Unicode path extra、重复或不规范路径。
- ExcelJS 载入前 SAX 校验：仅已验证 XLSX 部件；拒绝 DTD、命名范围、外部引用；工作表最多1个/id<=200；最多50000行、100列、**总100000个单元格**。提前限制合并/稀疏坐标/列范围，同时忽略非必要格式结构。CSV 也有总100000 cells、单cell20000字符上限。
- 规范化 Excel 的内容一律字符串，避免精度截断及公式注入。原始文件原样保留，不进行公式计算。

## 成本估算与上线门禁

无定时器，空闲请求数 = 0。单次操作最坏：1 token + 1申请 + 1文件GET = **3次外部请求**。每天40个动作上限即最多120次外部请求、最多400 MiB原始文件进入应用（通常远小于10 MiB/份）。普通云托管代理通常一次申请直接返回正文。

同一账单缓存复用，不重复下载；数据库持久化每份原文上限10 MiB（压缩后通常更小，但不假定压缩率）。本功能不自动删除历史账单，存储和备份会随实际拉取份数累积。此预算只是请求/字节上限，**不是费用承诺**：启用前仍须核对本账户云数据库、云托管网络和备份计费与容量，监测账单延迟。未新增 OSS/CDN 调用，也无资源包覆盖假设。

上线步骤：

1. 保持无定时任务，确认 DB 备份、私有访问控制及容量。先本地 tests/build 与隔离数据库验证。
2. 精确执行 `npm run migrate:remote -- --file=create_payment_bill_tables.sql --dry-run` 预览；获准部署窗口再去掉 `--dry-run`。禁止无文件参数执行全部历史迁移；禁止生产 `synchronize`。
3. 部署后以管理后台超级管理员每个通道各取一个有交易日。普通微信必须在真实云托管验证；Xpay 检查结算汇总语义、原文哈希、预览和下载。
4. 同一天再次点击两轮，日志/测试断言确认 `attempted=0`（或等价外部请求计数0）；核查401/403、账户隔离及审计。真实原文/密钥/URL不得进入 git 或共享日志。
5. 检查短时外呼、数据库增长和后续延迟账单，使用现有预算/余额/用量告警。无业务理由不要自动清理缓存或启用定时同步。

回滚：先回滚应用到不注册 `PaymentBillModule` 的版本，保留两张表以保存缓存与审计；不要直接 DROP。确需删除账单数据时需另获明确授权并先做可恢复备份。

本地验证命令：`npm test -- --runInBand src/modules/payment-bill`，`npm run build`。隔离数据库综合验收使用仓库 `scripts/verify-payment-bills-local.cjs` 的参数说明；不得拿真实生产数据库作自动化测试目标。
