# 待实现 / 进行中计划

> 写这个文件是为了不忘记进行中的事。完成一项就划掉或更新。

## 未完成（高优先级）

### 1. 续跑高德 amap 全量轨迹采集
- **背景**：2026-11-05 高德 Web 服务**日配额耗尽**（`infocode=10044 USER_DAILY_QUERY_OVER_LIMIT`），全量采集被中断。
  - 已采 **419 方向（≈214 条线）**，含谌家矶问题线 **211 / 232 / 634**（斜切弦已消除）。
  - 剩余 **~848 条线**仍走 OSRM 兜底；其中少量新城区线（路网缺失）仍有弦，其余郊区直路弦属正常。
- **触发条件**：高德日配额于**北京时间 0:00 重置**后执行。
- **命令**（采集器有跳过逻辑，已是 `amap` 的行自动跳过 → 断点续跑不丢进度）：
  ```powershell
  # 免费 Web 服务 Key，无需签名（已在本地用过，可复用）
  $env:AMAP_KEY="75134897b6ea3686545a60bc7748511e"
  npm run scan:routes:amap            # 方案 A：全量补齐剩余 ~848 条
  # 方案 B（省额度）：先 npm run scan:manifest 筛出 source=osrm 且 chord 多的“真断点”线，
  #   再用 --only 只采这些，其余留 OSRM（视觉已可接受）
  npm run scan:manifest               # 采集完务必刷新 src/static/lines/manifest.json
  ```
- **决策点**：A 全量 / B 仅补路网缺失的问题线。额度敏感优先 B。

## 可选优化

### 2. `lines.json` 改为运行时 fetch（消除冗余副本）
- **现状**：`src/static/lines.json` 仍被 `src/utils/lineIndex.js` 以 `import` 方式**打包进 bundle**；
  uni-app 又会把整个 `static/` 拷到产物，导致它在 `dist/static/` 里多一份冗余副本（APP 实际用的是 bundle 内那份）。
- **方案**：改成与 `src/static/network.json` 一致的**运行时 HTTP 拉取**（异步初始化），
  缩小首屏 bundle，也契合最初“线路库/线网数据走 HTTP 缓存”的设计意图。
- **代价**：`suggestLines / findLine / allLines / LINE_COUNT` 需异步化，牵连所有调用方（多为 Vue computed/watch，需加 `ensureLoaded()`）。

## 备注 / 约束
- 高德 Key **仅本机离线采集用**，不进代码、不入库、线上 App 零调用 → 无运行时额度风险。
- 资产分片 `src/static/lines/bNN.json` 为运行时**按需 HTTP 加载**（见 `src/utils/lineAsset.js`），
  **切勿合并进 `lines.json`**（会把几万条站点明细塞进首屏 bundle，体积膨胀十几倍）。
- `src/static/lines/manifest.json` 是给开发者看的单一索引，每次跑完采集后用 `npm run scan:manifest` 刷新。
