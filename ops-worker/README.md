# Practice Hub 异步工作节点

该节点运行在与 OSS 同地域的阿里云轻量服务器上，负责：

- 通过 OSS 内网下载已迁移的 PDF；
- 串行生成完整/试读缓存的前几页 JPEG；
- 回写 PDF 页数缓存；
- 定时检查后端、工作节点接口、OSS 内网和 CDN。

节点不承接小程序业务流量，也不代理文件下载。

## 必需环境变量

- `WORKER_API_BASE_URL`
- `PREVIEW_WORKER_TOKEN`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_BUCKET`
- `OSS_REGION`
- `OSS_INTERNAL_ENDPOINT`
- `PREVIEW_ALLOWED_SOURCE_HOSTS`

可通过 `PREVIEW_MAX_JOBS_PER_RUN` 控制每轮处理文件数，2C2G 实例建议保持为 `1`。
