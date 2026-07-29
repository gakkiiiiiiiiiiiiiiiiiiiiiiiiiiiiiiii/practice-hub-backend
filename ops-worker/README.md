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

可通过 `PREVIEW_MAX_JOBS_PER_RUN` 控制每轮处理文件数，2C2G 实例建议保持为 `1`。
试读补齐阶段默认每轮串行处理 20 份资料，可通过 `PREVIEW_MAX_TRIAL_JOBS_PER_RUN` 调整。
