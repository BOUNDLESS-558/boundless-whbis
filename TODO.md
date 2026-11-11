# 待实现 / 进行中计划

> 写这个文件是为了不忘记进行中的事。完成一项就划掉或更新。

## 未完成（高优先级）

### 1. 续跑高德 amap 全量轨迹采集
- **背景**：2026-11-05 高德 Web 服务**日配额耗尽**（`infocode=10044 USER_DAILY_QUERY_OVER_LIMIT`），全量采集被中断。
  - 已采 **419 方向（≈214 条线）**，含谌家矶问题线 **211 / 232 / 634**（斜切弦已消除）。
  - 剩余 **767 个 OSRM 方向 + 345 个 empty 方向**（2026-11-09 复核，见 manifest）仍待补；
    其中少量新城区线（路网缺失）仍有弦，其余郊区直路弦属正常。
- **2026-11-09 进度**：新增 `scripts/scan-foreign.mjs` 采集非集团线路（蔡城/木兰）**116 条 / 223 方向**，
  全部为高德官方轨迹（`source:'amap'`），已落 `CCB*/MLB*` 分片。该轮把当日配额用尽，
  **集团剩余方向当天未能补全**（探针再次返回 10044）。原采集器自带断点续跑，不丢进度。
- **触发条件**：高德日配额于**北京时间 0:00 重置**后执行（建议先跑集团、再跑非集团增量）。
- **命令**（采集器有跳过逻辑，已是 `amap` 的行自动跳过 → 断点续跑不丢进度）：
  ```powershell
  # Key 走环境变量 / GitHub Actions Secret，绝不写入仓库
  #   本地：已设置用户级环境变量 AMAP_KEY（不进版本库；轮换后需同步更新）
  #   CI  ：仓库 Settings -> Secrets and variables -> Actions -> AMAP_KEY
  npm run scan:routes:amap            # 方案 A：全量补齐集团剩余方向
  # 方案 B（省额度）：先 npm run scan:manifest 筛出 source=osrm 且 chord 多的“真断点”线，
  #   再用 --only 只采这些，其余留 OSRM（视觉已可接受）
  npm run scan:manifest               # 采集完务必刷新 src/static/lines/manifest.json
  ```
- **决策点**：A 全量 / B 仅补路网缺失的问题线。额度敏感优先 B。

### 1b. 汉奇公交（✅ 已采集完成，2026-11-09）
- 曾误判「高德未收录」。**根因是关键词格式**：线路号实际是中文前缀的
  `汉奇K6路` / `汉奇12路` / `汉奇22号线` / `汉奇定制公交1~4号线` / `汉奇景景有约巴士`，
  而当时查的是「汉奇」「汉奇1」，且 `parseNo` 正则只认 `[A-Za-z]+\d+`，中文开头一律丢弃。
- **正确链路**（配额池独立于 `linename`）：
  `/v3/assistant/inputtips?datatype=busline` 拿线路 POI id → `/v3/bus/lineid?id=...` 取站点+走向。
  即使 `linename` 日配额 10044 耗尽，这条链路仍可用 `npm run scan:foreign -- --hanqi-only` 单独跑。
- **结果**：8 条 / 14 方向全部为高德官方数据，落 `src/static/lines/HQB*.json`；
  `汉奇K6` 双向 11/10 站、297/313 个走向点，站点 ID `HQB0001` 起。
  合并后非集团线路库 124 条（HQ 8 / CC 7 / ML 109）。

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
