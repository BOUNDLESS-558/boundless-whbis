# Cloudflare Worker Cron 触发器部署（免费，替代 GitHub Actions 不可靠的 schedule）

## 原理

```
Cloudflare Worker (每 3 分钟 cron)  →  GitHub Actions API (workflow_dispatch 即时启动)
                                  →  scan-vehicle-ops.mjs 采集 → Neon 数据库
```

- GitHub Actions 的 `schedule` 高峰可延迟 3~12 小时甚至丢任务；
- 但通过 API 触发的 `workflow_dispatch` 是即时的（不走 schedule 队列）；
- Cloudflare Workers 免费版提供 5 个 Cron Trigger（本方案用 1 个），每 3 分钟发 1 个请求（480 次/天），远低于 10 万/天额度。
- **为什么是 3 分钟而不是 1 分钟**：单轮全库采集约 70~80 秒，1 分钟间隔会让轮次堆积、最终被 GitHub 取消（实测约 26% 轮次 cancelled）；3 分钟间隔（180 秒）远大于单轮耗时，彻底无堆积。Worker 另有「运行中不重复触发」保护作为双保险。

## 一次性配置（约 5 分钟）

### 1. 创建 GitHub PAT

1. 打开 https://github.com/settings/personal-access-tokens/new
2. Token name: `whbis-cron`
3. Resource owner: `BOUNDLESS-558`
4. Permissions → Actions: **Read and write**
5. Create token → **复制 token**（只显示一次）

### 2. 安装 wrangler 并登录

```bash
npm install -g wrangler
wrangler login          # 浏览器授权 Cloudflare 账号
```

### 3. 部署 Worker + 设置密钥

```bash
cd deploy
wrangler deploy                       # 部署 Worker（cron 自动生效）
wrangler secret put GITHUB_TOKEN      # 粘贴上一步的 PAT
```

### 4. 验证

```bash
wrangler tail                         # 实时日志，应看到每 3 分钟一条 "已触发"（或"跳过本次触发"）
```

或手动触发一次：访问 `https://whbis-cron.<你的子域>.workers.dev/trigger`，应返回 `triggered`。

## 停用 GitHub Actions 的 schedule（避免重复触发）

部署 Worker 后，把 `vehicle-ops.yml` 的 `schedule` 段删掉，只保留 `workflow_dispatch`（Worker 通过 API 触发它）。

## 费用

全部在免费额度内：
- Cloudflare Workers: 1 个 cron + 4.3 万请求/月（额度 10 万/天）
- GitHub Actions: dispatch 触发的采集（公开仓库免费；私有仓库 2000 分钟/月，每 3 分钟一轮约 1~2 分钟/轮可能超额度——建议仓库设为 public 或按需调整频率）
- Neon 免费版 + Vercel Hobby 免费版：已有
