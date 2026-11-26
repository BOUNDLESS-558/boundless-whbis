# 武汉公交信息实时查询（WuhanBus App）

基于 **uni-app（Vue 3 + Vite 5）** 的武汉公交信息实时查询应用，覆盖武汉公交集团及蔡城、木兰、汉奇等独立营运主体的全线网。

## 项目用途

本项目旨在为武汉市民提供一个**统一、实时、跨营运主体**的公交信息查询平台。核心能力：

- **线路查询**：按线路号搜索，支持数字 / D / K / 电 / BRT / C / P / 汉奇中文前缀等全部号段
- **站点详情**：查看经过某站的全部线路（含换乘卡片与所属公司徽标）
- **实时车辆**：在线车辆 GPS 位置、车速、到站状态、自编号还原
- **线路走向**：OSRM 道路吸附 + 高德官方公交轨迹双链路，自绘走向图 / 原生地图双模式
- **时刻表**：首末班时间、发车计划
- **全市线网**：全市在运车辆实时分布（扫描 / 自动跟随 / 按线路筛选），并附**车速榜**与**自编号尾号查车**
- **离线资产**：线路静态资产（站点 / 走向 / 时刻表）懒加载缓存，减少网络请求
- **线路收藏与复制方式**：线路收藏（`whbis:fav-lines:v1`，上限 10 条）+ 文本 / Excel / 图片三档复制（全站共享）
- **本地账号**：预置账号制，默认口令 = `genPass(账号)`（不落地），密码可改为 `hashPass(账号, 新密码)`（仍不存明文）

**目标平台**：Android App + Web（PC/移动浏览器）
**技术栈**：uni-app 3.x / Vue 3 / Vite 5
**项目位置**：`D:\Development\Workspaces\boundless-whbis`（Git 仓库根目录）
**远端仓库**：`https://github.com/BOUNDLESS-558/boundless-whbis.git`（origin）
**接口文档**：`武汉公交信息实时查询API接口文档.md`（仓库根目录，UTF-8）

### 分支约定（★ 务必遵守）

- **`main`**：当前维护分支（仓库当前分支），日常改动提交在这里，不直接新开功能分支。
- **`BETA`**：开发分支，改动提交到 `main` 后合并进 `BETA`，保持两者同步。
- **`pages`**：已删除（GitHub Pages 已关闭）。H5 主站部署在 **Vercel**（`https://boundless-whbis.vercel.app/`）。

工作流（按用户要求）：在 `main` 上提交改动 → 合并到 `BETA` → `git push origin main` 与 `git push origin BETA`。**推送 `main` 即触发 Vercel 自动构建部署**，无需手动构建或推送产物分支。

---

## 更新日志

> 按日期倒序，只记要点，细节见对应提交。

### 2026-11-26（最新）

- **采集**：修 15 分钟采集的 401（对齐两端 `VEHICLE_OPS_TOKEN`）；加 MD5 字典缓存、延长超时；保留 Actions 与快照 + 数据库双写。
- **数据面板**：新增按日表与历史回填；年/月/日/公司/线路筛选、记录时间列、车速配色、公司徽标、可选每页条数与分页。
- **导出**：改为下载真 Excel / 图片文件（手机可用）；全站按钮改名「导出」，统一 Emoji + 文字。
- **账号**：改为数据库存储 + 本地兜底，登录 / 改密 / 重置调用不变。
- **移动端**：三栏宽度对齐、浮窗避开输入卡；线网改由线路站点资产生成。
- **交互**：默认进入实时地图；全市取消激活码；扫描弹窗改深色玻璃风格；站点补地铁换乘标识；底部栏「自动跟随」移到「重扫」旁。
- **分析结论**：高德站点与自编号映射表暂不入库。
- **线路库翻页修复**：分页条改两行布局（每页选项独占一行），翻页按钮去掉重复字号并加 `white-space: nowrap`，窄屏收紧页码，避免「上一页 / 下一页」被挤压换行而显示不全。
- **数据面板重构**：筛选区改「汇总条 + 四组独立折叠」（窄屏默认收起，先看数据）；10 列横滚表格改为紧凑概览行 + 点按展开详情，PC / 移动端同一套 flex-wrap 结构自适应；分页重做为两行（条数 / 每页 / 跳页 + 翻页按钮 / 可横滑页码）。保留原筛选、排序、导出与 API 兜底逻辑。
- **面板徽标与超速标签**：营运公司由集团 logo 图改为实时车辆面板同款金色圆形序号徽标（非集团走各自公司标）；超速次数分七档标签（守规标兵 → 偶尔飘一下 → 有点上头 → 风驰电掣 → 秋名山车神 → 狂飙选手 → ≥50 次「暴躁车神」），颜色随档位变化并写入展开详情。
- **常驻采集守护进程**：新增 `scripts/daemon-vehicle-ops.mjs` 与 `npm run daemon:ops`，在常驻机器上每 45 秒（`OPS_INTERVAL_MS` 可调）跑一轮全市采集并直写 Neon 数据表，不触发 GitHub Actions；并发默认 32、轮次不叠加，需配 `VEHICLE_OPS_API` / `VEHICLE_OPS_TOKEN`。Vercel / Cloudflare Serverless 与浏览器后台均无法常驻，故必须跑在常驻主机上。

### 2026-11-24

- 数据面板接入 Vercel 数据库，修 CI 循环触发，静态快照兜底。
- GitHub Pages 下线，全面迁 Vercel（`main` push 自动部署）。
- 主题色扩至 999 种、圆体字体扩充；新增 15 分钟车辆营运采集与数据面板。
- 数据面板字段补全、加营运线路号，修 UI 重叠与搜索框字体。
- 高德采集反转主辅链路并限流；免 Key Cookie 改为每人自己的账号。
- 实时线路并入地图（默认不弹出）、移动端响应式；采集频率改 12 小时。
- 皮肤简化为仅黑色；新功能须兼顾 PC + 移动端。

### 2026-11-23

- 底部栏合并视图工具、新增「重扫」统一分发；修重扫丢快照 bug；编号标签升级三档。
- 全市线网视觉分层（精简/全部/关闭）、飞线根因修复（切段剔坏点）、远景补主干。
- 全市两浮窗常驻 + 位置记忆；查车多结果面板内滚动；拖动 / 重绘卡顿优化。
- 车速榜支持输入线路号单线查询，失败回退保留上次结果；查无此线给明确提示。
- 高德 KEY 拆双输入框并修生效；Actions 日志标注站点来源；646 路走向修复。
- 主题色 / 字体大幅扩充（移除调色盘）；AGENTS.md 按当前代码重写。
- CI 采集改每 2 小时 + 高德全量重拉。

### 2026-11-20

- 采集频率 6h→2h；收录 18 条 H 系惠民公交。
- 自编号补全：采 buspedia 全量映射（131 车型 / 18614 编号），修映射规则与年份冲突（新批次优先）。
- 全市面板重构：工具移入浮动条、控制卡变矮；车速榜 UI 重设计并接入复制。
- 自编号查车支持尾号模糊匹配（跨公司），查车面板加入复制。
- 复制图片字体跟随界面字体；修在线车辆复制「所在站点」破坏 TSV。
- README 按实际落地修正（移除过时 BYOK 描述、重写地图模式与目录结构）。

### 2026-11-15

- 营运公司采集双链路（buspedia + 在线自编号反推），全库 org 570→604。
- 931 路标记停运；站点换乘卡加公司徽标；环形线路 UI 补齐。
- 算路优化：K-d Tree 最近邻、公交方向判定、bbox 过滤、route 评分。
- CI 构建修复；移除重复 import。

### 2026-11-14

- CI 采集修缺失路径过滤与 detached HEAD 推送；POI 采集对齐 ditu.amap.com，AMAP_KEY 解耦。

### 2026-11-13

- 新增「记住我」、OSRM 走向改进、每日自动采集流水线。
- 408 内外环漏采与闭环退化修复；getPoiNewbus 兼容模式与 amap.id 回填。

### 2026-11-12

- 就地下拉全局互斥；复制菜单改胶囊正下方。
- 「更新」按钮贴边隐藏 + 「更新信息」入口；修停运线路状态与走向偏离。

### 2026-11-11

- 新增高德网页端站点采集器，补全 60 个线路方向；远端自动补 9 个走向方向。

### 2026-11-10

- CI 定时窗口改北京时间 03:20 / 周一 04:40。
- CI 失败也提交台账、每周重试未命中、台账自检、全量 checkout；schedule 事件显式放行采集。
- 采集器支持 `--max-lines` 与 CI 日志，清单生成幂等。

### 2026-11-09

- 高德 Key 明文移除，改环境变量 / Secrets 注入。
- 新增 turbo 账号、面板标题优化、高德断点续跑与备用链路，补 371 个方向；站点详情标题加宽。

### 2026-11-08

- 公交站牌仿真图与交互增强；统一滚动条风格；修面板尺寸记忆持久化。

---

## 一、如何启动

### 方式 A：网页版（H5）— 最快，浏览器直接看

```bash
cd D:\Development\Workspaces\boundless-whbis
npm install          # 首次运行需要，已安装可跳过
npm run dev:h5
```

启动后终端会打印地址，浏览器打开：

```
http://localhost:5173
```

按 `Ctrl + C` 停止。`dev:h5` 自带 `/api` 跨域代理。

### 方式 B：Android App

**第 1 步：生成 App 资源包**

```bash
npm run build:app
```

产物生成在 `dist/build/app`。

**第 2 步：用 HBuilderX 出包**

1. 下载安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（Windows 版）
2. HBuilderX → 文件 → 打开目录 → 选择 `D:\Development\Workspaces\boundless-whbis`
3. 打开 `src/manifest.json` → 可视化界面：
   - **基础配置**：填写应用名称、AppID（点"重新获取"可生成测试 AppID）
   - **权限配置**：定位 / 网络权限已配好
   - **模块配置**：勾选 **Maps**（地图）与 **Geolocation**（定位）
   - **第三方 SDK**：`app-plus.distribute.sdkConfigs.maps.amap.key` 填写 Android 平台的高德 Key（不填则 `useNativeMap()` 为假，地图页走自绘走向图）
4. 菜单 → 发行 → **原生 App - 云打包** → 选择 Android → 打包

> 云打包需要 DCloud 账号登录。打包完成后下载安装包即可真机安装。

### 方式 C：运行单元测试

```bash
npm run test:md5      # MD5 实现单测（RFC 1321 向量 + 实测对照）
npm run test:busid    # 车辆编号还原测试（全量建字典约 400ms）
npm run test:routeclean # 站点序列清洗回归（离线读 network.json，不发请求不写文件）
```

三个测试都是 `node scripts/*.mjs`，失败时退出码非 0，可直接当 CI 用。改完 `md5.js` / `busId.js` / `routeClean.js` 必须跑对应测试。

### 方式 D：常驻后台采集（45 秒直写数据库，不使用 GitHub Actions）

`npm run daemon:ops` 会常驻循环，每 **45 秒**跑一轮全市车辆采集，采集结果经 `/api/vehicle-ops` 直接写入 Neon 数据表（`vehicle_ops` 累计表 + `vehicle_ops_daily` 按日表），不再触发 GitHub Actions。

```bash
# 在一台常驻在线、能访问外网的机器上运行（VPS / NAS / 旧手机 Termux / 家用小主机）
export VEHICLE_OPS_API=https://boundless-whbis.vercel.app/api/vehicle-ops
export VEHICLE_OPS_TOKEN='与 Vercel 环境变量中同名的值保持一致'
export OPS_INTERVAL_MS=45000     # 可选，默认 45 秒
export OPS_CONCURRENCY=32        # 可选，默认 32（45 秒窗口需高于 Actions 的 6）
npm run daemon:ops
```

注意：**Vercel / Cloudflare 的 Serverless 函数无法常驻后台**（按请求触发、执行完即销毁），浏览器后台定时器也会被节流冻结，所以这个守护进程必须跑在一台常驻机器上。若单轮超过 45 秒则结束后立即开下一轮、不叠加并发。上游接口本身有频率限制，并发不宜再往上加。

### 常用命令速查

| 命令 | 作用 | 产物位置 |
| ---- | ---- | -------- |
| `npm run dev:h5` | 启动网页版开发服务器 | 内存（热更新） |
| `npm run build:h5` | 构建网页版 | `dist/build/h5` |
| `npm run build:app` | 构建 Android App 资源 | `dist/build/app` |
| （Vercel 自动） | `main` push 触发构建部署到 `boundless-whbis.vercel.app` | — |
| `npm run daemon:ops` | 常驻循环，每 45 秒抓全市车辆并直写数据库（替代 Actions） | Neon 数据表 + 静态快照 |
| `npm run test:routeclean` | 站点序列清洗回归（离线读 network.json，不发请求不写盘） | — |
| `npm run scan:lines` | 枚举探测线路网，合并写线路库（只补强不降级） | `src/static/lines/lines.json` |
| `npm run scan:org` | buspedia 采集营运公司写 `org`（含手动核实映射） | `src/static/lines/lines.json` |
| `npm run scan:org:live` | 在线车辆自编号反推营运公司（只补强不降级，`--dry` 预览） | `src/static/lines/lines.json` |
| `npm run scan:busnumber` | buspedia 车队页采集完整自编号映射（需 `BP_USER`/`BP_PASS`，支持 `--retry`/`--limit`/`--parse-only`） | `src/static/data/bus-number-map.json` |
| `npm run scan:foreign` | 高德采集蔡城 / 木兰 / 汉奇线路（需 `AMAP_KEY`） | `src/static/lines/{cc,ml,hq}/` |
| `npm run build:foreign-net` | 由非集团资产生成 `network-foreign.json` | `src/static/net/network-foreign.json` |
| `npm run test:md5` | MD5 单元测试 | — |
| `npm run test:busid` | 车辆编号还原测试 | — |

---

## 二、目录结构

```
boundless-whbis/
├── index.html                 # H5 入口模板
├── vite.config.js             # Vite 配置（含 H5 开发跨域代理 /api）
├── package.json               # npm 命令（dev:h5 / build:h5 / build:app / scan:* / test:* 等）
├── scripts/
│   ├── test-md5.mjs           # MD5 单元测试（RFC 1321 向量 + 实测数据）
│   ├── test-busid.mjs         # 车辆编号还原测试（终止性 + 正确性 + 性能）
│   ├── test-route-clean.mjs   # 走向清洗回归测试（离线读 network.json）
│   ├── set-h5-base.mjs        # 构建时切换 h5.router.base（Vercel 根域用 /）
│   ├── vercel.json            # Vercel 部署配置（buildCommand / outputDirectory）
│   ├── auto-collect.mjs       # 自动采集入口（scan-org 累积回填）
│   ├── scan-lines.mjs         # 枚举探测线路网 → src/static/lines/lines.json（只补强不降级）
│   ├── scan-org.mjs           # buspedia 采集线路 org 字段（只补强不降级，--force 覆盖）
│   ├── scan-org-live.mjs      # 在线车辆自编号反推营运公司（MD5 首位归属，补 D/K/YX 线）
│   ├── scan-foreign.mjs       # 高德采集蔡城/木兰/汉奇（需 AMAP_KEY）
│   ├── build-foreign-net.mjs  # 由非集团资产生成 network-foreign.json
│   ├── scan-routes.mjs        # OSRM 驾车贴路（免 Key，可断点续跑）
│   ├── scan-routes-amap.mjs   # 高德官方轨迹（正式 Web Service Key，仅本地采集用）
│   ├── scan-poi-newbus.mjs    # 高德 D/K 等新站 POI 采集
│   ├── scan-busnumber.mjs     # buspedia 车队页采集完整自编号（需 BP_USER/BP_PASS）
│   ├── scan-amap-ids.mjs      # 高德 ID 全量回填工具
│   └── probe-*.mjs            # CDP 探针（地图走向/贴路/配色/榜单等，先跑 dev:h5）
├── deploy/
│   └── cloudflare-worker.js   # ★ Cloudflare Worker 反向代理（解决 H5 生产 CORS 预检）
├── README.md
├── AGENTS.md                  # 仓库工作规约（接口协议、地图双模式、探针约定）
├── TODO.md                    # 待办清单
└── src/
    ├── main.js
    ├── App.vue
    ├── config.js              # ★ 应用配置（openId / cityCode / apiProxy / 地图 Key + useNativeMap）
    ├── manifest.json          # App 打包配置（Android 权限 / 地图 SDK）
    ├── pages.json             # 路由与全局样式配置
    ├── pages/
    │   ├── login/login.vue    # 账号登录（本地账号制）
    │   └── map/map.vue        # 实时车辆地图（自绘走向图 / 原生地图 + 站点 UI 内嵌）
    ├── components/
    │   ├── LineSearch.vue     # 线路搜索（地图页顶部）
    │   ├── LineStops.vue      # 线路详情 / 站点 UI（地图页 FloatWin 内嵌：站点 / 时刻表）
    │   ├── LineDb.vue         # 线路库窗（地图页 FloatWin 内嵌）
    │   ├── LineMap.vue        # ★ 走向图绘制（自绘 / 原生双模式）
    │   ├── LinePlan.vue       # 发车计划组件
    │   ├── SpeedRank.vue      # 车速榜（速度分档 + 复制）
    │   ├── Signboard.vue      # 站牌仿真（公交站牌图）
    │   ├── FloatWin.vue       # 可拖动浮窗（实时线路窗 / 线路库 / 线路详情等）
    │   ├── FavStar.vue        # 线路收藏星标
    │   ├── FavPanel.vue       # 收藏夹面板
    │   └── CopyPill.vue       # 复制胶囊（文本 / Excel / 图片三档）
    ├── utils/
    │   ├── api.js             # ★ 接口请求层（封装 3 个公交接口 + 车辆还原再导出）
    │   ├── busId.js           # ★ 车辆编号逆向还原（分片异步构建字典，防卡 UI）
    │   ├── busNumber.js       # 完整自编号补全（懒加载 bus-number-map.json）
    │   ├── busDir.js          # 上下行判定 / 方向辅助
    │   ├── md5.js             # 纯 JS MD5 实现（RFC 1321，零依赖）
    │   ├── geo.js             # ★ Haversine 距离 + 车辆匹配最近站点 + GCJ-02 ⇄ WGS-84
    │   ├── osrm.js            # ★ 站点序列吸附 OSM 道路（OSRM，免 Key，7 天缓存）
    │   ├── asset.js           # ★ 基址感知的静态资源路径解析（子路径部署）
    │   ├── companies.js       # 营运公司字典（缩写 / 颜色 / 号段 / 分片）唯一真源
    │   ├── lineIndex.js       # 线路库 + 联想检索池（资产零请求）
    │   ├── lineAsset.js       # 线路静态资产懒加载（内存缓存 + 去重）
    │   ├── routeClean.js      # 走向清洗规则（生成器与运行时共用）
    │   ├── kdtree.js          # 站点最近邻查询（K-d Tree）
    │   ├── favorites.js       # 线路收藏（`whbis:fav-lines:v1`，上限 10 条）
    │   ├── clipboard.js       # 统一复制（copyTable + 图片 ClipboardItem）
    │   ├── dropdown.js        # 就地下拉全局互斥仲裁（Attach 接入）
    │   ├── settings.js        # 各类偏好（面板尺寸 / 位置 / 地图来源等）
    │   ├── panelResize.js     # 浮层面板可拖拽改宽 / 高（H5）
    │   ├── panelPos.js        # 面板位置记忆 / 自由移动
    │   ├── cityBus.js         # 全市快照：车辆归属推断 / 自编号尾号查车
    │   ├── speedRank.js       # 车速榜（速度分档）
    │   ├── auth.js            # 本地账号预置账号制（登录 / 改密 / 恢复默认）
    │   └── avatar.js          # 用户头像载入
    └── static/
        ├── lines/             # 线路库数据资产（lines.json + manifest.json + bNN 分片）
        ├── lines/jt/          # 集团线路资产（bNN.json 64 桶哈希，含站点与走向）
        ├── lines/cc|ml|hq/    # 非集团线路资产（CCB*/MLB*/HQB*）
        ├── lines/foreign-lines.json  # 非集团摘要
        ├── net/               # 实时网络（network.json / network-foreign.json）
        ├── data/bus-number-map.json  # 完整自编号映射（~3.6MB，懒加载）
        └── img/               # logo / stop-dot / bus-live / background 等
```

---

## 三、下一步计划

- [x] 工程初始化、架构搭建、双端构建验证
- [x] 接口协议破解（POST + header openId）
- [x] MD5 车辆编号还原 + 完整自编号补全（buspedia 映射）
- [x] 真实数据联调：线路 / 站点 / 时刻表 / 实时车辆 / 地图
- [x] H5 生产部署：Cloudflare Worker 反代 + Vercel 自动部署
- [x] 线路收藏（`whbis:fav-lines:v1`，上限 10 条）+ 文本/Excel/图片三档复制
- [x] 蔡城 / 木兰 / 汉奇非集团线路统一纳入检索与全市线网
- [x] 本地账号制（预置账号 + 可选改密）
- [ ] 配置高德 Key，验证 Android 真机原生地图
- [ ] 公交到站距离估算（基于 GPS 与站点坐标）
- [ ] 如需原生渲染体验，评估 nvue / uni-app x 路线