# AGENTS.md — 武汉公交信息实时查询（WuhanBus）

uni-app（Vue 3 + Vite 5）跨端应用：H5 网页版 + Android App，查询武汉公交线路、站点、时刻表、实时车辆。
远端 `origin` = `BOUNDLESS-558/boundless-whbis`，分支：`main`（源码主干）、`BETA`（开发分支）。**GitHub Pages 已关闭、`pages` 分支已删除**；H5 主站部署在 Vercel（`https://boundless-whbis.vercel.app/`），`main` push 自动构建部署。

## 交付约定（★ 用户明确要求，每次改完自动执行，不要再问）

每次完成功能改动后，**主动**做完整交付，不等用户逐条要求：
1. **同步 `README.md`**：在「更新日志」顶部新增当天日期条目（当天已有就合并），写明本次改动要点。README 与代码冲突时以代码为准，但 README 不能落后。
2. **提交并推送两分支**：`main` 提交 → 合并到 `BETA` → `git push origin main` 和 `git push origin BETA`。**不再需要手动部署**：Vercel 监听 `main` push 自动构建部署（配置见 `vercel.json`）。
3. **推送前处理 CI 采集分叉**：`git fetch origin`，若 `origin/main` 有新的「数据: 自动采集更新」提交，先 `git merge origin/main`；资产文件冲突一律保留本地手工修复版本（用 `git checkout --ours -- <file>` 后 `git add`），再推送。`README.md` / 代码文件一般无冲突。
4. **收尾验证**：`main`/`BETA` 的 `git rev-parse` 与 `origin/<branch>` 一致、工作区干净；临时探针 / `%TEMP%` 下的 Edge profile 全部清理。

**部署（Vercel）**：`vercel.json` 指定构建命令 `node scripts/set-h5-base.mjs / && npm run build:h5`、产物 `dist/build/h5`。`main` push 自动触发部署；`set-h5-base.mjs` 把 `manifest.json` 的 `h5.router.base` 切为 `/`（根域），无需服务端重写（hash 路由）。GitHub Pages 已关闭。

**GitHub Actions 自动采集**：`.github/workflows/daily-collect.yml`（标题「自动采集+自动发布」）每 12 小时跑 `scripts/auto-collect.mjs`：采集 → 提交数据到 `origin/main`（Vercel 随之自动重建部署）。所以远端 `main` 会持续有新提交，推送前必须 merge。workflow 只认默认分支（main）上的文件；`schedule`/`workflow_dispatch` 依赖它。

## ★ 开发规范（2026-11-24 起，用户明确要求，后续不再反复强调）

### 1. 双端兼容性（PC + 移动端）
- **以后设计开发的新功能，必须同步考虑 PC 端和移动端的双端兼容性。**
- 必须保证 PC 端功能能在移动端完整呈现且操作流畅。
- 移动端屏幕有限，需在有限空间内完整呈现系统功能；涉及布局/面板/浮窗的功能，开发前先评估移动端是否塞得下，必要时做响应式适配或折叠/抽屉化处理。

### 2. 皮肤
- **仅保留黑色皮肤（默认），移除白色皮肤和「跟随系统」选项。**
- `src/utils/settings.js` 的 `SKIN_OPTS` 仅含 `{ key: 'dark', label: '黑色' }`；`resolvedSkin()` / `applySkin()` / `watchSystemSkin()` / `setSkin()` 均简化为仅深色逻辑。
- `src/App.vue` 中 `html[data-skin='light']` 相关 CSS 块全部移除。

### 3. 高德采集：SSR 为主、linename 为辅助（2026-11-24 反转）
- **主方案 = SSR**（`scan-poi-newbus.mjs`，`ditu.amap.com/ssr/api`，免 Web 服务 Key、仅需 Cookie）：`--overwrite` 覆盖 `route + stops`，是最终落盘权威数据源。覆盖时写 `source:'amap'` + `row.amap.primary='newbus'`，站点 stopId 是高德 POI id（poiid2）而非 BV 前缀。
- **辅助方案 = linename**（`scan-routes-amap.mjs`，需 AMAP_KEY）：`auto-collect.mjs` 用 `--retry-unmatched`（不带 `--force`），只补台账未完成/SSR 未命中的线路，不再全量覆盖 SSR 数据。
- **判据兼容**：`scan-routes-amap.mjs` 的 `isAmapStops()` 已认 `primary==='newbus'` 为已转换（不再只看 BV 前缀），避免 `--backfill-stops` 误把 SSR 站点当集团站重采；linename 重采时清掉 `primary` 标记防失真。
- 前置：SSR 需要资产里有 `amap.id`，由「POI id 回填」步骤（`scan-amap-ids.mjs`，需 Key+Cookie）写入；执行顺序为 ① id 回填 → ② SSR 主方案 → ③ 主链路辅助 → ④ 站点补齐。
- **限流**：`--batch-size` 默认 3（每 3 条线暂停 3×DELAY）；`queryAmap()` 内 3 次重试 + 退避，防 QPS 过密导致「查无此线」误判。

### 4. 采集频率
- 地图站点数据采集 Actions 的触发时间：**每 12 小时一次**（cron `0 */12 * * *`）。
- 车辆营运信息采集 Actions（`.github/workflows/vehicle-ops.yml`）：**每 15 分钟一次**（cron `*/15 * * * *`），全库线路×方向拉 `detailData`，按日期时间分片落盘 `src/static/vehicle-ops/YYYY-MM-DD/HHMM.json`，累计档案写 `src/static/vehicle-ops/profile.json`。

### 5. 数据面板（`src/components/DataPanel.vue`）
- 视图档 `data`，不依赖选线（地图常驻底座上开浮窗）。展示每车：所属公司 / 营运线路号 / 自编号 / 首次上线 / 最终下线 / 最高车速 / 超速次数（徽标）/ 历史发车次数 / 调配记录。
- 数据源优先级：`/api/vehicle-ops`（Vercel Serverless Function + Neon 数据库，实时）→ 失败回退静态 `src/static/vehicle-ops/profile.json`（本地 dev / 未配库）。API 地址在 `config.js` 的 `APP_CONFIG.vehicleOpsApi`。
- 支持关键词筛选 + 车速/超速/发车/编号/线路号/上下线排序；导出走全站 CopyPill（文本/Excel/图片三档统一 `copyTable`）。
- 数据库：`api/vehicle-ops.js`（GET 读 / POST 写，`x-api-key` 鉴权）、`api/init.sql`（建表）；写库环境变量 `VEHICLE_OPS_API` / `VEHICLE_OPS_TOKEN`（GitHub Secrets）；读库靠 Vercel 注入的 `DATABASE_URL`。
- **CI 套娃防护**：所有采集 commit 都带 `[skip ci]`，避免数据 push main 反触发 daily-collect 全量采集循环。

### 6. 免 Key Cookie（每人用自己的高德账号）
- 前端：`src/pages/map/map.vue` 设置面板「免 Key Cookie」分区；`settings.js` 的 `getAmapWebCookie`/`setAmapWebCookie` 存 localStorage；`buildAmapCookieConfig` 生成仓库配置文本。
- 桥梁：`scripts/amap-cookie.json`（cookie 字段），用户填入自己的 Cookie 提交后，Actions `daily-collect.yml`「加载用户免 Key Cookie」步骤优先读该文件注入 `AMAP_WEB_COOKIE`，留空则回退 Secrets。
- 分区键：`ACCT_SECTION_KEYS` 已把「线路走向 map」与「免 Key Cookie cookie」合并为单一 `amap` 分区（标题「高德数据源」，Cookie 主 / KEY 辅）。此前 `map` 曾漏登记导致折叠失效，已一并修复。

### 7. 面板整合（已完成）
- 「实时线路面板（stops）」已并入「实时地图（map）」视图：`views` / `VIEW_KEYS` / `LINE_VIEWS` 不再含 `stops`；`LineStops` 浮窗在地图视图渲染，**默认关闭**，由 `LineMap` 底部栏新增的「🚏 站点」按钮显式开合（`stopsWin` 开关）。选线/换线/切视图都不再自动弹出（用户明确要求：每次点开地图就自动弹站点窗体验差）。
- 站点序列、在线车辆、营运信息、极简站牌、复制走向图等功能完整保留在地图浮窗内，无缺失。

### 8. 移动端响应式
- `src/components/LineSearch.vue`：≤720px 时视图分段凹槽横向滚动（`seg-groove` overflow-x auto）、`seg-tab` 不压缩、隐藏 `vr-meta`、缩小 padding；PC 端不受影响。
- `FloatWin` 已有 `max-width: calc(100vw - 40rpx)`，`.ctrl` 已有 `max-width: calc(100vw - 24rpx)`，小屏不会溢出。
**部署不依赖本地构建**：推 `main` 即触发 Vercel 构建部署；本地 `build:h5` 只用于验证产物能否编译。

日常验证**不要主动构建**：`build:h5` / `build:app` 只在交付或用户明确要求出包时执行，日常验证用 `dev:h5` + 探针/单测（用户原话：「没有必要每次都构建一下生成的产物」）。

提交前注意：`src/config.js` 的 openId 是占位值、`apiProxy`（Cloudflare Worker 地址）不涉密，可入库；用户自填的高德 KEY/安全密钥只存浏览器 localStorage（`whbis:amap-key`），不入源码。

## 其它公交公司 / 数据源（2026-11-09 起）

武汉公交不止公交集团，还有**蔡城（C 线）/ 木兰（P 线）/ 汉奇**等独立营运主体。用户明确要求**统一通过高德获取**（旧「汉奇智慧出行」小程序接口要签名、401，已弃用）。

- `scripts/scan-foreign.mjs`（`npm run scan:foreign`）→ `src/static/lines/foreign-lines.json` + `cc/CCB01.json` / `ml/MLB01.json` / `hq/HQB01.json`（站点 + 走向分片）。
  - **两条高德链路**（配额池独立）：蔡城 `C*` / 木兰 `P*` 走 `/v3/bus/linename?keywords=`；汉奇线路号是中文前缀（`汉奇K6路`、`汉奇12路`、`汉奇22号线`、`汉奇定制公交1~4号线`、`汉奇景景有约巴士`），必须 `/v3/assistant/inputtips?datatype=busline` 拿 POI id → `/v3/bus/lineid?id=` 取完整站点/走向。`linename` 报 10044 时可用 `--hanqi-only` 走独立配额。
  - 采集器「只补强不降级」：先读回已有摘要/分片再合并，本次零命中不写盘。
  - 分片命名：集团 `jt/bNN.json`（64 桶哈希），非集团 `cc/CCB*`、`ml/MLB*`、`hq/HQB*`，由 `utils/companies.js` 的 `foreignShardOf()` 与 `utils/lineAsset.js` 的 `shardName()` 定位。高德站点原 `BV...` id 落盘改写为 `${abbr}B${序号}`，原值存 `originId`。
  - 高德只给静态站点 / polyline / 首末班 / 票价，**无实时车辆**。非集团线路 `realtime:false`，`loadLive()` 跳过 `/detailData`，UI 标注「静态数据」。
  - 汉奇 8 条已实测采集完成；曾误判「高德不收录汉奇」是因关键词写成「汉奇1」且正则只认字母数字，已修正。
- `scripts/build-foreign-net.mjs` → `src/static/net/network-foreign.json`，单独文件，不并进 `network.json`（`scan:net` 重跑不覆盖）。
- `utils/companies.js` 是公司字典唯一真源（缩写 / Logo / 颜色 / 号段正则 / 分片名）。`companyOf(line)` 是公司判定与徽标的统一出口，**永不返回 null**（集团线即使 `org` 缺失也返回集团徽标）。
- **不设「其它公交公司」开关**（用户明确要求）：非集团线路恒定并入检索池、全市线网、线路库、搜索联想、实时视图。历史键 `whbis:show-foreign` 已移除。
- **线路库筛选按营运主体归并**：公司行只有 `全部 / 公交集团 / 蔡城公交 / 木兰公交 / 汉奇公交`。集团下属各营运公司、`org` 未收录的历史线、`数字/电/BRT/K/D` 等号段全归「公交集团」；号段细分是选中「公交集团」后的二级行。`companyOf(line).label` 对集团一律「公交集团」，分公司全名在 `.full`。**`lineIndex.orgOf()` 已删除，别再引入**。
- 复制方式（`whbis:copy-mode`，默认 text）：所有复制按钮统一走 `utils/clipboard.js` 的 `copyTable({title, columns, rows, text})`，不要直接调 `uni.setClipboardData`。档位不在设置面板，由 `CopyPill.vue` 右半下拉提供，切换经 `onCopyModeChange` 全站广播。新复制入口直接用 `<CopyPill label="…" @copy="fn" />`。
- 就地下拉全局互斥：`utils/dropdown.js` 是唯一仲裁器，经 `attachDropdown(vm, stateKey, prefix)` 接入（CopyPill / 刷新间隔 / 搜索联想），开关走 `vm._dd.open()/close()/toggle()`，卸载 `dispose()`。模态弹窗（账号窗 / 线路库详情）不注册，打开时调 `closeAllDropdowns()`。回归探针 `probe-copy-menu.mjs`。
- 收藏夹：`utils/favorites.js`（`whbis:fav-lines:v1`，上限 10 条）+ `FavStar.vue` + `FavPanel.vue`（挂设置窗分区）。

## 命令（已实测）

```bash
npm run dev:h5       # http://localhost:5173/boundless-whbis/，自带 /api 跨域代理
npm run build:h5     # → dist/build/h5
npm run build:app    # → dist/build/app（之后必须 HBuilderX 云打包）
npm run test:md5     # MD5 单测（RFC 1321 向量 + 实测）
npm run test:busid   # 车辆编号还原（全量建字典约 400ms，30s 超时）
npm run test:routeclean # 站点序列清洗回归（离线读 network.json，不发请求/不写文件）
npm run scan:lines   # 枚举探测线路网，合并写入 lines.json（生成器，会写文件）
npm run scan:org     # buspedia.top 采集 org 写 lines.json
npm run scan:routes:stops # 只拉站点→清洗→落 lines/（不调 OSRM，快）
npm run scan:routes  # 补算 OSRM 贴路几何（免 Key，慢，可断点续跑）
npm run scan:foreign # 高德采集非集团线路，需 AMAP_KEY
npm run build:foreign-net # 由非集团资产生成 network-foreign.json
npm run build:h5       # 本地构建验证（部署由 Vercel 自动完成）
```

- 三个测试都是 `node scripts/*.mjs`，失败退出码非 0，可当 CI。改 `md5.js` / `busId.js` 必跑；改走向清洗规则必跑 `test:routeclean`。
- `MODULE_TYPELESS_PACKAGE_JSON` 警告无害。**别给 package.json 加 `"type":"module"`**，会破坏 uni-app 工具链。
- Vercel 部署配置见 `vercel.json`（buildCommand / outputDirectory / rewrites）；H5 根域 base 由 `scripts/set-h5-base.mjs /` 在构建时切换，不改动仓库里的 `manifest.json`（保持 `/boundless-whbis/` 以兼容历史）。

### 地图回归探针（先 `npm run dev:h5`，端口可能顺延 5174/5175）

端口不确定用 `PROBE_BASE` 传真实地址。默认 base `http://localhost:5173/boundless-whbis/`——**必须带子路径**（`manifest.json` 的 `h5.router.base`），写 `/` 会 404。

**探针不产出任何文件**：不截图、不写日志；要断言就 `Runtime.evaluate` 取量测值打控制台。临时排查用的 CDP 脚本命名 `scripts/probe-*.tmp.mjs`，**用完即删**；`%TEMP%/edge-*-prof` profile 目录异常中断会残留，定期清。合法写文件例外：`probe-osrm-visual.mjs` 导出 `.openchamber/geom-*.json` 给 `probe-roadfit.mjs`（用完即删）、数据生成器落盘数据资产。
**同理：绝不把密钥、Cookie、token 写进探针输出或仓库。**

| 命令 | 作用 |
| --- | --- |
| `probe-osrm-visual.mjs 337 40 [--mobile]` | 清缓存→等吸附→导出走向几何。`FOCUS="站A\|站B"` 拉近段 |
| `probe-roadfit.mjs .openchamber/geom-337.json 80` | 贴路体检：中位数 0~2m、P90 ≤5m、unmatched 0 点 |
| `probe-nearest.mjs 337 0` | 坏段诊断：每端点最近 3 条路 + 两两规划，识别吸到高架/对向车道 |
| `probe-label-overlap.mjs "<url>" 30 [--mobile]` | 站名/车号/圆点两两重叠，四类全空才算过 |
| `probe-line-colors.mjs 337` | 实时线路视图方向配色，读 `.seg`/圆点/页签计算样式 |
| `probe-hover-focus.mjs` | 悬停浮标 + 「在地图上定位」落点；**改布局后必跑** |
| `probe-ctrl-row.mjs 337` | 左上控制卡版式：整卡包裹 / 四块左缘对齐 / 单行方向行 / tab 居中 / 徽标紧邻线路号，跑 1440·390·360·320。**改 `.ctrl` 内版式后必跑** |
| `probe-refresh.mjs 337 [PROBE_VIEW=stops]` | 刷新控件体检（map/stops 两视图），含结构/存储/真实请求节奏 |
| `probe-osrm-legs.mjs 337 0` | 逐段垂距明细，调 OSRM 阈值时用 |
| `probe-line-suggest.mjs` | 地图页线路号联想：面板定位/排序/命中总数/白名单（J1、G73 必须"未收录"）。**改 `lineIndex.js` 或搜索区后必跑** |
| `probe-646-*.mjs` | 646 路专项（direct/offset/quality/render/v4/verify），排查该线路走向/回环 |

## 线路库与线路号联想

后端只有「按 lineCode 查单条」的 `/line`，**无线路列表接口**，线路库靠枚举探测生成：`scripts/scan-lines.mjs` → `src/static/lines/lines.json`（`utils/lineIndex.js` 直接 import，构建期进 bundle，联想 0 请求）。**只补强不降级**，别改成整文件覆盖；不想联网时用 `node scripts/scan-lines.mjs --normalize-only --merge`。

- **判据是 `lineName` 有值**，不是站点非空（2/3/5/11/19 路有 lineName 但站点为空，按站点判会漏 14 条）。反向复核用另一方向补站数/起讫站。
- **`lineCode` ≠ 线路号**：后端 lineCode 是内部编码（`1001`=电1、`2001`=J1、`81`=H81）。JSON 的 `no` = 归一后的真实线路号（展示/联想），`code` = lineCode（查询）。别混用，否则 J/H 线会以数字混进库。
- **前缀白名单只有 `电 / BRT / K / D`**，传其它字母报错退出；落盘前剔除 H/J 前缀及测试线路。分批扫描带 `--merge`。
- 已知数据缺口：73 条无站数、10 条无起讫站，UI 兜底显示「站数未知 / 起点未知」，不是 bug。
- `org` 字段由 `scripts/scan-org.mjs` 从 buspedia.top SSR 数据按 `no` 匹配写入（只补强不降级，`--force` 才覆盖），并由 `scan-org-live.mjs` 从在线车辆自编号首位反推补全（CI 每轮累积）。覆盖不全属正常，剩余是小众 D/K 线。
- **联想检索池与全量库分离**：`suggestLines`/`countMatches` 走 `SEARCH_INDEX`（武汉公交全量），`allLines()` 也只回武汉公交。`LineSearch` 命中上抛 `{lineCode, lineName, direction, startStop, endStop}`，宿主 `applyPick` 换线。
- **线路库筛选按公司归并**见上文「其它公交公司」；不要恢复按分公司/号段做一级公司分类。

## 接口协议（三条铁律）

后端 `https://customized.wuhanbus.com/gps-resapi/wechat/bus`，完整文档见根目录 **`武汉公交实时API接口文档.md`**（文件名不含「信息查询」）。

1. 必须 `POST + application/json`，GET 不支持。
2. **`openId` 必须放请求头**；放 query/body 返回 `90001`。值不校验——`config.js` 任意非空字符串即可。
3. `/line` 传 `lineCode`，`/detailPlanTime`、`/detailData` 传 `lineId`（用错报 `3014`）。格式 `{cityCode}-{线路号}-{方向0|1}`，由 `buildLineCode()` 生成。

响应判据 `payload.success === true && payload.msg.code === '20000'`（`api.js` 的 `post()`）。后端怪癖：响应 `direction` 与请求方向**相反**，一律以请求编码 / `stopDetailList` 顺序为准。

## 架构要点

- **页面只有 `login` 和 `map` 两个**（`/pages/login/login`、`/pages/map/map`）。旧 `index`/`line`/`settings` 页已删除，别再引用。`map` 页靠 URL query `view` 切档位：`VIEW_KEYS = ['map','city','stops','db','fav']`（实时线路 / 全市公交 / 站点 / 线路库 / 收藏），改跳转要同步改对端 `onLoad`。
- **请求 base 三段切换**（`api.js`）：H5 dev → `/api` 代理；H5 prod → `APP_CONFIG.apiProxy`（Cloudflare Worker 反代，`deploy/cloudflare-worker.js`，上游 `OPTIONS` 无 CORS 头）；App → 直连。
- **`busId.js`**：`busId = MD5(自编号)`，枚举 0~200000 建反查字典。分片异步（每片 8000 + `setTimeout`）防卡 UI；**就绪前 `decryptBusId()` 返回 null**，页面必须用 `onBusIdReady(cb)` 二次刷新。终止条件必须 `end >= DICT_MAX`，写 `n <= DICT_MAX` 会在 `n == DICT_MAX` 死循环。
- **`geo.js`**：Haversine + 车辆最近站点。⚠️ 接口坐标**已是 GCJ-02**，直接上高德；`wgs84ToGcj02()` 只用于确实持有 WGS-84 的场景，误用整体偏数百米。
- **`asset.js`**：`assetUrl()` 用 `import.meta.env.BASE_URL` 拼前缀，适配 `h5.router.base = /boundless-whbis/`（hash 路由）。marker icon / `<image>` / CSS 背景等不经构建期改写的引用必须走它。
- **本地账号（`auth.js`）**：预置账号制，默认口令 = `genPass(账号)`（确定性 md5 派生，不落地）。用户改密只把 `hashPass(账号,新密码)` 写进 `whbis:pass-override`（`normAccount` 小写主键），仍不存明文。**登录/校验一律走 `verifyPass()`**，别在别处直接比 `genPass`。改密/恢复默认要先验当前密码（`changePassword`/`resetPassword`）。这是「使用门槛」非安全机制。

### 地图双模式与高德 KEY（判据是 `useNativeMap()`）

两套视觉完全不同的渲染：「自绘走向图」（青蓝/玫红双轨 + 白心站点 + 白底站名贴片）与「原生 `<map>`」（高德底图 + 原生 marker/polyline）。**唯一判据 `config.js` 的 `useNativeMap()`**：
- **App 端**：Key 随安装包内置（`manifest.json` 的 `sdkConfigs.maps.amap.key`），`APP_CONFIG.mapKey` 非空 → 原生地图。
- **H5 端**：`APP_CONFIG.mapKey` 留空（现状）→ `useNativeMap()` 恒假 → 一律自绘走向图。
- ⚠ 不要恢复「三档渲染开关」（`map_render_mode` 已删），页面里别自己拼 `hasMapKey()` / `APP_CONFIG.mapKey` 变体。

**用户自填高德 KEY 的用途边界**（2026-11-23）：**不会**把 H5 切成原生地图；只让**自绘走向图**通过 JS API 2.0 的 `AMap.LineSearch` 拉官方公交轨迹替换 OSRM 贴路。设置面板「账号与设置 → 高德地图 KEY」有**两个独立输入框**：`Key（Web端 JS API）` + `安全密钥（JS API 2.0，选填）`，各自显隐眼睛；`settings.js` 的 `getAmapKeyPair()`/`setAmapKeyPair()` 成对读写，存储 `whbis:amap-key` = `key,secret`（兼容旧单框格式）。关键坑：
- **Key 必须是「Web端(JS API)」类型**；Web服务 / REST Key 用在 JS API 会返回 `USERKEY_PLAT_NOMATCH`（infocode 10009）且被 SDK 静默吞掉——`fetchOfficialLines` 的 LineSearch 失败回调要弹明确提示，别静默。JS API 2.0 配了安全密钥时经 `window._AMapSecurityConfig` 传入（用户用英文逗号两框填，UI 已拆开）。
- **换 KEY 必须重新注入 SDK**：`loadAmapJsApi()` 只复用 `window.__whbisAmapKey === 当前 key` 的实例；换 KEY 要清掉旧 `window.AMap` 和 `_AMapSecurityConfig` 再注入，否则新 KEY 被旧实例吞掉、永远不生效。`onAmapKeyChange()` 由设置面板保存后经 `this.$refs.mapC.onAmapKeyChange()` 调用，重置 `amapOfficial` 后按当前线路重规划。
- 官方轨迹由 `routeMatchesStops` 校验（平均偏离 <900m 且远离站点 >1.5km 占比 <25%）才采纳，不吻合就丢弃回退资产/OSRM（防 K524 类同名错线）。这是保护机制，不是 KEY 失效。
- 采集脚本用的 `AMAP_KEY` / `AMAP_SECRET` / `AMAP_WEB_COOKIE` 是**服务端 Web 服务 Key**（环境变量、CI secrets，不入仓库），与上面对话框的 Web端 JS API Key **不是一回事**，别混用。

走向图底座：
- **底图**：`.tile-layer` 用 `<image>` 拼高德标准瓦片（`webrd0{1-4}.is.autonavi.com/appmaptile?...style=8`，免 Key、GCJ-02、256px），`zt=floor(zoom)` + `scale=2^(zoom-zt)` 定位，叠 `.tile-shade` 暗蒙版。`.tile-layer` 需浅底色，否则 z18 下未加载瓦片一大块黑。
- **走向**：静态资产优先（见下），无资产时 `utils/osrm.js` 调 OSRM（WGS-84，需与 GCJ-02 互转）吸附站点序列。
  - 逐段质检用**最大垂距**，不要用「规划距离/直线距离」ratio——站前掉头 ratio 11 只偏 76m 却真实，吸到高架 ratio 17 已跑 3km 外。
  - 四级修复：贴走廊 → 加 1/3、2/3 途经点 → **换端点吸附候选**（`/nearest?number=3`）→ 站间直线。第三级是实测关键：坏段根因是站点被吸到高架层/对向车道；吸附点离站 >60m 不认，用 `distance >= straight*0.8` 剔除「跳过」而非「绕开」。
  - 已实测**无效、不要重试**：`exclude=motorway`、`alternatives=3`、foot/walking profile、FOSSGIS；以及免 Key 拿高德官方轨迹的三条野路子（iframe 嵌入 / 直拉 amap.com 接口 / OSM relation，代码注释有记录）。对应临时探针已删。
- 走向未贴路时画站间直连（细虚线 + `routeAlert`）。**判断截图前先确认吸附完成**（无 alert），别把初屏当结果。
- **线路静态资产优先（A+B 混合）**：`src/static/lines/**`（集团 `jt/bNN.json` 64 桶 + 非集团 `cc/ml/hq` 分片），每条线路双方向含 `base`/清洗后 `stops`/`route`（展平 GCJ-02）/`snapped`/`source`/`algo`。`source`：`'amap'` 高德官方轨迹（A，优）；`'osrm'` 驾车近似（B，兜底）。`utils/lineAsset.js` 懒加载（内存缓存 + Promise 去重，不进 bundle/localStorage），命中即不发 `/line`，`assetSnapped` 为真连 OSRM 也不请求；404 回退原链路。
  - **A（`scripts/scan-routes-amap.mjs`）**：`/v3/bus/linename?extensions=all` 一次返回 `polyline` + `busstops`。Key 仅本地采集（环境变量 `AMAP_KEY`，不入库）。返回即 GCJ-02 直接落盘。按号拉全方向、起讫站名匹配方向，**只写 `source:'amap'` 行**。默认 `--delay 1100`，小样本先 `--only 337,909,273`。
  - **B（`scripts/scan-routes.mjs`）**：**只算非 amap 方向、永不覆盖 amap 行**（哪怕 `--force`）。算法版本 `VERSION` 行内记 `algo`，版本不符重算。只用免 Key OSRM，串行 + `--osrm-delay`，支持断点续跑。
  - **清洗规则 `utils/routeClean.js` 唯一真源**：运行时与两生成器共用（生成器经 `scripts/_loadRouteClean.mjs` 用 data: URL 载入，因无 `type:module`）。规则：过滤 `0/0`/越界、按 `stopNo` 排序、相邻 <5m 去重、剔孤立离群点/折返簇/端点错点/**整段坐标重复**（`dropDuplicateRuns`，修 909 型「两套站名塞两遍→巨大矩形」，只认正序、相隔 ≥5 站、连续 ≥3 点重合，环线逆序不误删）。B 额外 `stripLoops`（保护真环线）+ 收紧 leg 质检（驾车 ≤ 直线*2.2+350，坏段过半退站点连线）。回归 `npm run test:routeclean`。**别放宽规则追「长跳变段数」**——292 路 20.9km 跨区、只有 2 站 D 线属真实/残缺数据，删了误伤。
  - `fitRoute()` 包围盒**包含贴路几何**，否则绕行段被裁掉。

### 全市公交视图（`LineMap.vue`）

- **两浮窗常驻**：车速榜 `SpeedRank.vue` 与 `org-search` 自编号查车默认打开（只有点浮窗 ✕ 显式存 0 才隐藏）；进入 `view=city` 自动出现。开关、折叠、输入、档位、位置全 localStorage，二次进入/重载恢复到上次状态。
- **浮窗可拖动**：`utils/panelPos.js` 的 `bindFloatDrag(handle, panel, onDrag)` 只绑标题栏 grip（`.rk-grip`/`.os-grip`，`fd-nodrag` 排除按钮），`clampPanelPos()` 夹进视口；车速榜位置 `whbis:panel-pos:v1:rank-card`、查车 `whbis:panel-pos:v1:org-search`。拖动后 `rankPos`/`orgPos` 非空，自动解除 `stacked`/`with-rank` 上下错开约束（否则 inline left/top 与 CSS top 冲突）。卸载要解绑（`_unbindOrgDrag`、`_unbindDrag`）并 `cancelAnimationFrame`。
- **车速榜两种模式**：`单车榜`（全局快照按车速降序）/ `线路榜`（输入线路号 → `fetchLineVehicles()` 只请求该线路各方向 `/detailData`，1~2 个请求，**不触发全网 1500+ 扫描**，列出该线路在运车辆按车速降序）。模式/档位/线路号持久化（`whbis:rank-mode`/`rank-limit`/`rank-line-no`）。
  - **线路号精确归一**：输入 `337`/`337路`/code 内嵌号只匹配 337，**不误命 D337/K337**（早期用「末尾连续数字」匹配会误命，已改精确比对）；`cityBus.js` 的 `fetchLineVehicles()` 与 `speedRank.js` 的 `rankByLine()` 两侧的匹配口径必须一致。
  - **请求失败 ≠ 没车**：`fetchLineVehicles()` 返回 `failed` 计数；`onLineInput()` 若「全部方向失败且一辆车都没拿到」判定请求失败——**保留上次成功结果**、弹「单线查询失败，保留上次结果，请重试」，绝不把好数据替换成「无在运车辆」。只有请求真成功返回 0 辆才显示无车；首次就没成功过则回退全市快照过滤。上游超时/断连偶发，这个护栏防误判。
  - 输入中只记本机 + 让旧结果失效（`onLineTyping`），**不逐字发请求**；点「查询」或回车才发。标题显示「单线查询」时刻（`lineStampText`），非全市快照时刻。
- **查无此线**：`stopsLoaded` 标记区分「仍在加载」「已加载完但无数据」「未输入」。不存在的线路显示「未查询到『线路号』路的线路走向，请检查线路号」，**不要永久卡在「正在加载线路走向…」**。切线路时 `applyHostLine()`/`loadByLine()` 重置标记，`loadAllStops()` 结束时置 true。
- **卡顿优化**：拖拽/滚轮/双指的高频重绘经 `scheduleRender()` 用 `requestAnimationFrame` 合并（每帧最多一次全量投影）；`renderCityNet()` 上万点 SVG 拼接用 `Math.round(v*10)/10` 替代 `toFixed(1)`；卸载取消待执行帧。别改回逐事件同步 `renderSchematic()`。
- **两窗共存布局**：车速榜 `stacked` 压上半区、查车 `.with-rank` 落下方的 CSS 只在两窗都未拖动（`!rankPos && !orgPos`）时生效，拖动后各自 inline 定位。
- 全市车辆快照 90 秒新鲜期（`whbis:city-snapshot:v1`），一轮扫描 1500+ 请求、并发 8；无全市后端接口，只能枚举线路库逐方向 `/detailData`。线网底图是静态资产（`network.json` + `network-foreign.json`），不占 API 配额。

### 方向配色（全站唯一真源 `src/components/LineMap.vue` 的 `DIR_STYLE`）

上行青蓝 `#06B6D4`/`#22D3EE`，下行玫红 `#F43F5E`/`#FB7185`（色盲友好）；环线紫罗兰。⚠️ `DIR_STYLE` 在 `LineMap.vue`（不是已删除的 `map.vue`/`line.vue`），别再找错文件。
- 上下行同屏**必须分轨**：SVG 投影各偏 3.5px，原生 `offsetPolyline()` 各偏 14m。
- 原生折线层序：白色外描边（9）→ 方向色主线（5）；**下行不加虚线**（与青蓝主线打架）。
- 原生视野由 `fitNativeView()` 自适应：`fitRoute()` 只算自绘 `cam`，不写 `mapScale`/`mapCenter` 会让原生 `<map>` 永远停在 scale 13（「走向不好看」头号原因）。scale 按包围盒反算并同步 `_view`。
- 站点图标四张（`stop-dot-{0,1}.png` 11→13px 白心环、`stop-end-{0,1}.png` 19px 实心）由 `scripts/make-stop-dot.ps1` 生成；车辆图标 `scripts/make-bus-icons.ps1` 生成 `bus-live-{0,1}.png`。站名用 `label`（白底贴片 + `labelText`），显式 `borderColor` 透明否则 uni-h5 描一圈边。车辆圆点提亮一档（`#67E8F9`/`#FDA4AF`）+ 白描边。`.ttag` 地铁标签用紫色避开上行青蓝。

### 地图页的 uni-h5 陷阱（踩过且无人报错）

- **`markertap` 参数在 `e.detail` 里**：`normalizeCustomEvent()` 只给 `{type,timeStamp,target,currentTarget,detail}`，没有扁平 `markerId`；`e.markerId` 恒 undefined→「点车没反应」。`regionchange` 同理。
- **marker 绝不能传 `title`**：uni-h5 用 `title` 建隐藏 callout，click 监听又 `callout.visible = !visible`→每点一次冒白框。站名用 `label`；不挂 `callout`。
- 折线 `color` 只吃十六进制（`hexToRgba` 不认 `rgba()`），callout `bgColor` 反过来只认 `rgba()`。H5 的 `arrowLine` 是空属性（仅 App/小程序生效）。

### 地图页交互

- **车辆详情是可拖动浮窗**（`.bus-sheet`，非底部弹层）：无遮罩、标题栏拖动、`📌` 固定、`✕` 关闭。`sheetPos` px 绝对坐标，`clampSheet()` 夹视口，`window.resize` 重夹；鼠标拖用原生监听（`.sheet-head` mousedown，move/up 挂 `document`），`cleanup()` 解绑；拖动结束 120ms 内 `_suppressSheetClick` 屏蔽按钮误触。
- **悬停自编号**：marker 无 hover 事件，自做命中——`mousemove` 挂容器，`_projectTo()` 按 Web Mercator 投像素，<18px 命中；原生用 `_view`、自绘用 `cam/projCenter`，两边都要实现。
- **`focusBus()` 真定位**：原生同时写 `mapCenter`/`mapScale`/`_view`，否则下一轮 silent 刷新拽回。定位点不能死写屏幕中心（浮窗盖住），`freeSpot()` 跳过与 `.bus-sheet`/`.ctrl`/`.panel` 相交位置再反算中心。
- **自动刷新**（0/15/20/30 秒，`whbis:map-refresh-sec`）：`restartAutoRefresh()` 建定时器，`onShow` 拉起、`onHide`+`onUnload` 停；只在 `onLoad` 建会叠多个。silent 刷新（`loadLive(true)`）不关浮窗、不改中心。刷新 `mapKey++` 重建 `<map>` 前用 `_view` 还原视野。
- **左上控制卡「整卡包裹」**：`.ctrl` 本身就是玻璃卡（`padding:12rpx`+`border-radius:26rpx`+背景/描边/阴影），内部搜索行→`.ctrl-div`→主操作行→方向行→视图工具行。视图工具栏在最底部、方向行下方；**子块不要再自带背景/描边/阴影**（否则退回碎片感）；卡片内不放操作说明文字（已按用户要求删，别加回）。`.ctrl-dir` 单行 `nowrap`，线路号 `margin-left:auto` 靠右、徽标紧随（`.ctrl-org` 可压缩出省略号）。「切换方向」`cycleDirView` 是 `.dir-swap` 小方键紧贴三个 tab 右侧，着色 `'d'+dirFilter`。改版式后跑 `probe-ctrl-row.mjs`。
- 站名标签：窄屏（canvas <600px）按 `stride` 抽稀到约 10 个、zoom 门槛 10.5，首末站恒显示、碰撞上下微移。

### 面板自由缩放（`utils/panelResize.js`，仅 H5/桌面）

所有浮层可拖改宽/高并记忆，双击手柄复位。纯 DOM 辅助 `createResizable(el, opts)`（不依赖 Vue 响应式）：挂 `.rs-grip` 手柄（`edge: right|left|bottom|corner`），Pointer Events 写 `el.style`，松手落库。
- 接线：`.ctrl`（`key:'ctrl'`，右边手柄只改宽、高度固定）、`.side-col`（`key:'side'`，左手柄只改宽）、`.panel`/`.plan-side`（`maxHeight`）在 `LineMap.setupPanelResize()` 挂；`FloatWin` 靠 `resize-key` prop（stops/db/account）自身 `mounted` 挂，默认 `resize-axis='x'`（只改宽）。
- `.ctrl`/`.side-col` 缩放后必须回调 `measureUi()`，否则 `fitRect()` 不避让。`setupPanelResize()` 用 `el.__rs` 幂等，在 `measureUi` 末尾补挂（覆盖 `v-if` 重建），销毁函数进 `this._resizers`，`cleanup()` 里 `destroy`。
- 键 `whbis:panel-size:v1:<key>` 存 `{w,h}`；`FloatWin` 记忆值经 `rsW/rsH` 回流 `winStyle`，否则位置重渲染会用 `widthPx` 刷回。
- 手柄用 JS 内联样式（DOM 新建节点拿不到 scoped `data-v-*`）。仅 H5（App 无 `document` 直接 noop）；窄屏（≤720px）不接管，用面板自带响应式塌缩。

## 写探针的坑（`scripts/probe-*.mjs` / 临时 `probe-*.tmp.mjs`）

CDP 驱动 Edge headless 真实浏览器实测，`node scripts/probe-xxx.mjs` 直跑，**先 `npm run dev:h5`**。
- **一律不写文件**（截图/日志都算）：vite file watcher 会 watch 整个项目，探针写 `.log` 抛 `EBUSY` 并**直接杀掉 dev server**（表现为刚还 200、下一秒连不上）。要断言用 `Runtime.evaluate` 取量测值打控制台。
- **页面 readiness 用轮询**别固定 `sleep`（vite 按需编译，首次进页慢）。写 `waitFor(expr)` 直到 `!!window.uni && 目标元素` 成立。
- **同一 hash 路由内 `Page.navigate` 不重建页面**（`useMap`/`onLoad` 不重跑）。换存储/换模式必须 `about:blank` → 目标页，或 `location.reload()`。
- 页面实例沿 `__vueParentComponent` / `__vue_app__._instance.subTree` 找；**Vue reactive proxy 不能 by value 序列化**（直接 return 得 `{}`），逐字段取。
- **uni H5 存储值被包过**：`localStorage` 里是 `{"type":"number","data":15}`；`getStorageSync` 键不存在返回**空字符串**，`Number('')===0` 会把「没设过」误判成 0（而 0 是合法值）——业务代码先排除空值再比白名单。
- Edge 启动参数参考 `scripts/probe-ctrl-row.mjs`（`--headless=new --remote-debugging-port=<PORT> --user-data-dir=%TEMP%/edge-xxx-prof`）；CDP 连接后 `Page.enable`/`Runtime.enable`/`Network.enable`。登录态用 `seedLogin({send, BASE, sleep})`（`probe-auth.mjs`）。
- 验证 KEY / 网络类功能时，`Network.requestWillBeSent` + `Network.getResponseBody` 抓真实请求/响应；模拟失败用 `Network.emulateNetworkConditions({offline:true,...})`。**别把请求里的真实 KEY / 密钥 / Cookie 打进日志或仓库**。

## uni-app H5 渲染坑

- 横向滚动容器内内容行会被默认 `display:flex` 压到容器宽，**内容裁切而非滚动**：`.route-strip` 内层 `.strip-inner` 用 `display:inline-flex + min-width:100%` 做 shrink-to-fit，改线路带布局别删这两行。
- H5 的 rpx 在宽屏（>960px）按 **375 基准**换算（1rpx = 0.5px），不是窗口宽/750。桌面面板约 280px，别拿桌面宽反推 rpx。
- 右侧车辆面板约 280px：`.panel-tools` 独占一行；`.refresh-menu` 在 ≤720px 须 `top:auto; bottom:calc(100% + 14rpx)` 向上展开，否则被视口底边裁掉。
- 深色主题，全局背景/导航 `#0b1020`（`pages.json`），卡片毛玻璃 + 靛蓝/青渐变。各页 `<style>` 各自定义，无统一样式文件。⚠ `#06b6d4` 已被征用为上行色，别当普通信息色。

## 其他约定

- 详情页 / 实时线路视图刷新控件与地图页同款（`↻ | 间隔 ▾`），默认 15 秒，持久化 `whbis:line-refresh-sec`，与地图页 `whbis:map-refresh-sec` **各自独立**。定时器 `restartAutoRefresh()` 重建、`onShow` 起/onHide+onUnload 停，切自动立刻补拉一次。
- 营运公司徽标由在线车辆 orgId 首位推断（1→一公司），实时线路优先用时刻表 `orgBusId` 明文，缺失才回退实时车辆（MD5 还原）。`.dir-cur` 必须 `flex:0 1 auto + min-width:0`（`.dc-no` 配 `overflow:hidden; text-overflow:ellipsis`），否则长线路名把徽标顶出定宽控制卡。
- 方向徽标文字写全「上行 / 下行」，别缩成「上 / 下」。
- 中文源文件 UTF-8；PowerShell `Get-Content`/`Select-String` 输出控制台会乱码，读文件用编辑器工具，别把乱码当文件损坏。
- `README.md` 已与实际同步；若仍有出入，**以代码为准**，但要按「交付约定」把 README 补上。

## 采集 / CI 补充（2026-11-23）

- **Actions 站点来源日志**：`scripts/auto-collect.mjs` 每轮采集收尾调用 `writeStationSourceReport()`，逐条、分组、对齐打印全部线路：营运公司 / 线路号 / 「正在使用高德地图站点数据信息」或「无高德站点数据，正在使用 OSRM 兜底」/ 信息存储文件名；抬头强调「每次执行 Actions 都重新获取全部线路站点信息」。站点粒度按方向判定（`dirs[k].source`），任一方向 `source='osrm'` 即兜底。同时导出 `reports/osrm-lines.json`（`rule` 字段写判据、`total` + `lines[]`），随 `reports` 提交。排查走向偏差先查日志与清单。
- **646 路修复经验**：曾多次返修，根因是静态资产只有 24/25 站、丢了「官堤路公交场站」；用 `AMAP_KEY` 走 `inputtips → lineid` 重采到 36/35 站。**修线路走向先看资产站数/首末站与 polyline 端点是否吻合**，别只调 OSRM 参数。
- **高德全量重拉**：`auto-collect.mjs` 每轮用 `scan-routes-amap.mjs --force` 对全部线路、全部方向重新拉取高德官方轨迹与站点数据（跳过进度台账，确保站点信息与上游一致）；`--backfill-stops` 补齐「source 已是 amap 但站点还是集团 MD5 站号」的半成品（不限量，一轮扫完）。采集器都「只补强不降级」，CI 每 12 小时累积。高德免 Key 采集新增 `--batch-size 3` 限流：每 3 条线后暂停 3×DELAY，避免 QPS 过密导致 `/line` 返回「未找到」。
