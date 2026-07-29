# Practice Hub 异步工作节点

该节点运行在与 OSS 同地域的阿里云轻量服务器上，负责：

- 使用后端签发的短期 OSS 内网地址下载已迁移的 PDF；
- 使用 LibreOffice 将 DOC/DOCX 资料转换为临时 PDF；
- 优先为全部资料生成试读范围内的 JPEG，再串行补齐完整缓存，避免大文件阻塞后续资料试读；
- 每页完成后保存断点，任务中断后从下一页继续；
- 回写 PDF 页数缓存；
- 使用短期 OSS 内网上传地址写入预览缓存；
- 定时检查后端、工作节点接口、OSS 内网和 CDN。

节点不承接小程序业务流量，也不代理文件下载。
节点不保存阿里云 AccessKey；短期地址只能读写后端指定的单个对象。

## 必需环境变量

- `WORKER_API_BASE_URL`
- `PREVIEW_WORKER_TOKEN`

可通过 `PREVIEW_MAX_JOBS_PER_RUN` 控制每轮完整预览的批量文件数，建议设置为 `20`。
试读补齐阶段默认每轮串行处理 20 份资料，可通过 `PREVIEW_MAX_TRIAL_JOBS_PER_RUN` 调整。
`PREVIEW_CONCURRENCY` 控制同时处理的资料数；2C2G 建议设置为 `2`，4C8G 可设置为 `8`，
上限强制限制为 `8`。

完整预览只会为已有有效课程授权、有效套餐权限或免费课程生成；其他启用课程仅生成试读页。
需要立即补齐指定资料时，可将 `PREVIEW_START_CURSOR` 设置为目标文件 ID 减 1，
并将 `PREVIEW_TRIAL_ONLY=true`、`PREVIEW_MAX_TRIAL_JOBS_PER_RUN=1`，只生成该资料的试读页。

`PREVIEW_SOURCE_PROVIDER` 用于按源文件位置分流。源文件同时存在于 COS 和 OSS 时，
后端会按工作节点处理能力稳定分配约 20% 给阿里云节点、约 80% 给腾讯云节点：

- `oss`：阿里云上海节点，只读取 OSS 源文件并通过 OSS 内网上传预览图；
- `cos`：腾讯云上海节点，只读取仍在 COS 的源文件，并通过公网 PUT 将预览图写入 OSS。

腾讯云节点使用同地域 COS 源站域名，域名会在腾讯云上海环境解析为内网地址。
