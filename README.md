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

### 2026-11-26（最新）

- **采集鉴权与可靠性**：定位 `vehicle-ops.yml` 的 401 为 GitHub Secret 与 Vercel Env `VEHICLE_OPS_TOKEN` 值不一致（需两端手动对齐同值）；Actions 改 `cancel-in-progress: true`、`timeout-minutes: 30`，并用 `actions/cache` 缓存 20 万条 MD5 反查字典（脚本支持 `MD5_DICT_CACHE`），降低超时排队导致的实际间隔拉长。Hobby 套餐下 Cron 只能每天一次，故保留 15 分钟 Actions 并继续双写静态快照 + 数据库。
- **数据库按日表与面板筛选分页**：新增 `vehicle_ops_daily`（PK 日期+自编号，含 `recorded_at` 记录时间）及账号/会话表 `app_accounts`/`app_sessions`；`/api/vehicle-ops` GET 支持 `view=daily` 的日期/年月/公司/线路/关键词筛选与分页，POST 同时写累计表与按日表（`dailyOnly` 供回填）；新增 `scripts/backfill-vehicle-ops.mjs` 从历史按日快照回填。`DataPanel.vue` 重写：年/月/日/公司/线路联动筛选（含全部）、记录时间列、车速分档配色（复用 `SPEED_BANDS`）、营运公司徽标（复用 `companyOf`）、用户可选每页条数与分页（复用新 `utils/pagination.js`，`LineDb` 同步接入）。
- **导出体系统一**：新增零依赖 `utils/xlsx.js`（最小 OOXML + ZIP STORE）生成真 `.xlsx`；`clipboard.js` 的 Excel/图片档改为下载文件（App 端写临时文件后打开/存相册），解决手机图片导出不可用；全站按钮改名「导出」、图标改 Emoji + 文字（📊/🖼️/📋、🔄 同步、翻页箭头等），提示文案同步。
- **账号 DB 化 + 离线兜底**：新增 `/api/auth`（login/change/reset，会话 token，哈希与 `genPass/hashPass` 兼容），`auth.js` 优先走数据库，网络失败回退本机预置账号；登录/改密/重置在双端保持原调用签名，改密成功按来源提示。
- **移动端排版与线网数据源**：`LineMap.vue` 控制卡与实时车辆/发车时刻栏统一 `--panel-w` 与移动端边距，底部栏 z-index 提高防折叠覆盖；新增 `scripts/build-net-from-assets.mjs`，线网 `network.json` 改由各线路分片 `stops + route`（高德/OSRM 贴路）经 `routeClean.js` 清洗抽稀生成（901 线 / 1504 方向 / 34395 点）；`test-route-clean.mjs` 样本改为真实站点资产，三项单测通过。
- **需求 16/17 分析结论**：高德站点与自编号映射表暂不建议整库入库（静态分片缓存已满足、12h 才变、入库同步成本大于收益）；若未来需关系查询，可分别建轻量 `amap_stops` / `bus_number_map` 表。
- **移动端三栏宽度补强**：`.ctrl` 与 `.side-col` 在窄屏统一用显式 `width/max-width: calc(100vw - 40rpx)`，不再依赖 `width:auto`，避免不同机型 rpx 换算下输入卡比实时车辆/发车时刻栏窄一截。
- **登录默认视图改为实时地图**：`map.vue` 的初始 `view` 从 `db`（线路库落地页）改为 `map`；`mapMount` 把无线路的实时地图也纳入底座，恢复线路失败/清除记忆/关闭浮窗等回退路径统一落回地图。保留「线路库」标签，仍可手动进入原落地页。
- **移除全市公交激活码**：点「全市」标签直接进入全市公交，删除激活码弹窗、校验/持久化逻辑与相关样式；URL `?view=city` 也不再受激活状态拦截。
- **全市扫描告知弹窗风格统一**：`LineMap.confirmCitySweep()` 从白底系统 `uni.showModal` 改为应用内深色玻璃弹窗（🗺️ 只看线网 / 🔄 开始扫描，Emoji + 文字），与账号窗、线路库窗保持同一视觉。

### 2026-11-24

- **CI 套娃修复 + 数据面板迁 Vercel 数据库**：给 `auto-collect.mjs` 与 `vehicle-ops.yml` 的采集 commit 加 `[skip ci]`，避免数据 push main 反触发 daily-collect 全量采集形成循环。新增 `api/vehicle-ops.js`（Vercel Serverless Function：GET 读库 / POST 写库，`x-api-key` 鉴权，Neon serverless driver）与 `api/init.sql`（建表 + 索引）。`scan-vehicle-ops.mjs` 采集后把本轮数据 POST 到 `VEHICLE_OPS_API`（配 `VEHICLE_OPS_TOKEN`），静态 JSON 仍落盘作备份。`DataPanel.vue` 优先读 `/api/vehicle-ops`，失败回退静态 `profile.json`。`config.js` 新增 `APP_CONFIG.vehicleOpsApi`。新增依赖 `@neondatabase/serverless`。
- **GitHub Pages 下线，全面迁移 Vercel**：新增 `vercel.json`（buildCommand 先切 base 为 `/` 再 `npm run build:h5`，产物 `dist/build/h5`，hash 路由配 rewrites 兜底）与 `scripts/set-h5-base.mjs`（构建时切换 `h5.router.base`，不污染仓库 manifest）。`auto-collect.mjs` 移除「构建 H5 + 强推 pages 分支」步骤（Vercel 靠 main push 自动部署），删除 `deploy:pages` 脚本与 `deploy-pages.mjs`，远端 `pages` 分支已删除。AGENTS.md / README 同步更新分支约定与部署模型，主站为 `https://boundless-whbis.vercel.app/`。
- **主题色扩至 999 种 + 圆体扩充**：`ACCENT_PRESETS` 保留 537 条手工精选，模块加载时用 HSL 色环生成器补足 462 条（`x001`~`x462`，运行时实测总数 999）；设置面板新增「扩展 462」分类按 `xNNN` 前缀筛选。`FONT_OPTS` 新增 10 款圆体（中文：优设圆体/阿里妈妈方圆/汉字圆体/站酷圆体；英文：Quicksand/Nunito Sans/Muli/Sniglet/Baloo 2/Hind），归入「sans-cn / sans-en」分类。
- **数据面板加营运线路号 + 搜索框字体修复**：`scan-vehicle-ops.mjs` 每车档案新增 `lineNo`（营运线路号，如 337，跨分片取最后一次），面板表格/筛选/导出均加入该字段；搜索框加明确高度 68rpx + 行高 + placeholder 独立配色，避免自定义字体下中文显示不全。
- **数据面板字段补全 + UI 重叠修复**：面板表格改为完整展示所属营运公司（全名）/ 线路号（全部）/ 自编号 / 首次上线时间 / 最终下线时间 / 最高车速 / 超速次数 / 历史发车次数 / 车辆调配记录，固定列宽 + 横向滚动避免省略号；排序新增上线/下线维度，导出列同步对齐。修复「双重窗口」：DataPanel 原本自带卡片头（标题/关闭/导出），与外层 FloatWin 重复导致 UI 重叠——改为纯内容组件，操作行（时次/导出/同步）移到内部工具条，拖动与关闭交由外层 FloatWin。
- **高德采集主辅链路反转 + 设置分区合并 + 手机端底部栏遮挡修复**：SSR（`scan-poi-newbus.mjs`，免 Key、Cookie）改为主方案，`--overwrite` 覆盖站点/走向并写 `source:'amap'` + `amap.primary='newbus'`；linename 主链路（`scan-routes-amap.mjs`，需 Key）降为辅助，`auto-collect.mjs` 改用 `--retry-unmatched` 只补漏、不再 `--force` 全量覆盖。`isAmapStops()` 兼容 `primary==='newbus'` 站点（POI id 非 BV 前缀），避免 `--backfill-stops` 误把 SSR 站点当集团站重采；主链路重采时清掉该标记。设置面板「线路走向」「免 Key Cookie」合并为一个「高德数据源」分区（Cookie 主 / KEY 辅，带角色标签）。手机端 `.side-col` 从 `bottom:20rpx` 抬到 `96rpx` 给底部快捷栏让位（此前 z-index 20 盖住 z-index 11 的底部栏导致不可见），底部栏加 `max-width: calc(100vw - 24rpx)` 支持横向滑动。
- **实时线路面板并入实时地图 + 移动端响应式适配**：移除独立「实时线路（stops）」视图档（`views`/`VIEW_KEYS`/`LINE_VIEWS` 均不含 stops），`LineStops` 浮窗（站点/在线车辆/营运信息/极简站牌/复制走向图全部保留）在地图视图渲染但**默认不弹出**——选线/换线/切视图都不再自动打开，改由底部快捷栏新增「🚏 站点」按钮显式开合（`stopsWin`）。`LineSearch.vue` 在 ≤720px 下视图分段改为横向滚动、标签不压缩、隐藏状态文案、收紧内边距；PC 端不受影响。
- **数据面板 + 车辆营运信息 15 分钟采集**：新增 `src/components/DataPanel.vue`（视图档 `data`），展示每辆车的自编号 / 最高车速 / 超速次数（红色徽标）/ 上下线时间 / 发车次数 / 调配记录 / 营运公司，支持关键词筛选（编号/线路/公司）、车速/超速/发车/编号排序，导出走全站 CopyPill 三档。新增 `.github/workflows/vehicle-ops.yml`（cron `*/15 * * * *`）与 `scripts/scan-vehicle-ops.mjs`：全库线路×方向拉 `detailData`，按北京时间日期时间分片落盘 `src/static/vehicle-ops/YYYY-MM-DD/HHMM.json`，累计档案 `profile.json` 供面板「↻ 同步」读取。超速阈值默认 60 km/h，公司按自编号首位数字判定。
- **免 Key Cookie 改为每人自己的账号**：设置面板新增「免 Key Cookie」分区（`settings.js` 的 `get/setAmapWebCookie` 存本机，`buildAmapCookieConfig` 生成仓库配置）。新建 `scripts/amap-cookie.json`，用户填自己的高德网页 Cookie 提交后，Actions 新增「加载用户免 Key Cookie」步骤优先读该文件注入 `AMAP_WEB_COOKIE`，留空回退 Secrets。顺带修复 `ACCT_SECTION_KEYS` 漏 `map` 导致「线路走向」分区折叠失效的 bug。
- **采集频率改为每 12 小时 + 高德采集新增批量限流**：`.github/workflows/daily-collect.yml` cron 从 `0 */2 * * *`（每 2 小时）改为 `0 */12 * * *`（每天 00:00 / 12:00 触发）。`scripts/scan-routes-amap.mjs` 新增 `--batch-size` 参数（默认 3）：每处理 3 条线路后暂停 3×DELAY，降低高德免 Key 接口的 QPS 限流概率——连续请求过密会导致 `/line` 接口返回「未找到」（实际存在，如 1 路）。`queryAmap()` 内已有 3 次重试 + 退避逻辑，单条失败自动重试 3 次。同步更新 AGENTS.md 开发规范章节。
- **皮肤简化为仅黑色**：`src/utils/settings.js` 的 `SKIN_OPTS` 仅保留 `{ key: 'dark', label: '黑色' }`；`resolvedSkin()` / `applySkin()` / `watchSystemSkin()` / `setSkin()` 均简化为仅深色逻辑。`src/pages/map/map.vue` 移除「皮肤」分区 UI、相关 data / computed / method / 生命周期钩子。`src/App.vue` 移除全部 `html[data-skin='light']` CSS 块（约 51 行反色滤镜逻辑）。用户要求：以后设计开发的新功能必须同步考虑 PC + 移动端双端兼容性，PC 端功能需在移动端完整呈现且操作流畅。

### 2026-11-23

- **底部快捷操作栏合并视图工具 + 全市控制行清空 + 编号标签三档 + 快照保存修复**：将右下角独立的 `.view-tools-float` 浮条（放大 / 缩小 / 全览 / 站名 / 底图）全部并入 `.bottom-bar`，地图页不再同时出现两个浮动条。底部栏「刷新」按钮改名为「**重扫**」，新增 `bottomRescan()` 统一分发：线路态 = 刷新线路（`refreshNow`），全市态 = 重扫全网（`runCity(true)` / `cancelCity`），中止时图标转 ✕。全市控制卡 `.ctrl-city-row` 移除与底部栏重复的「重扫 / 查车 / 车速榜 / 跟随 / 编号标签 / 线网模式」全部六枚按钮，控制行清空仅作占位与 refit 锚点。**「编号标签」从布尔开关升级为三档循环**（`cityTagMode`：0=关闭 / 1=仅自编号 / 2=自编号+线路号+营运方向，格式 `337 · 319N2379 · 上行`），按钮标签动态显示当前档位，点击循环切换，持久化到 `whbis:city-tags`；自绘与原生两种渲染模式同步适配。**修复重扫不保存结果的 bug**：`sweepCity()` 之前只在 `!partial`（无取消、无失败方向）时才 `saveSnapshot`，一旦任一方向超时/失败就整份丢弃、下次复用旧快照；现在改为始终写缓存（有总比没有强），`partial` 标记保留供 UI 提示「本轮不完整」。线路态 = 重扫 + 视图工具 + 三向切换（9 枚）；全市态 = 重扫 + 视图工具 + 车速榜 / 查车 / 跟随 / 编号标签 / 线网模式（13 枚，**不显示上行/下行/全部方向分组**）。底部栏同步缩小（item 88×72→60×56rpx、图标 30→26rpx、标签 18→16rpx）并加 `overflow-x` 防溢出，保证小屏不被挤出。移除已废弃的控制卡底部 `.ctrl-settings` 快捷设置行。视觉风格统一（毛玻璃 + 分隔柱），方向键按上下行配色区分（↑青蓝 / ↓玫红 / ⇄紫罗兰），刷新时 ↻ 图标旋转动画复用 `rp-spin`。**鼠标悬停车辆图标时的浮标内容与编号标签模式联动**：`onHoverMove()` 两分支（全市态 / 线路态）均按 `cityTagMode` 组装——mode 0 不弹浮标，mode 1 仅显示自编号，mode 2 显示 `自编号 · 线路号 · 营运方向`（单行完整格式，与地图标签文本格式完全一致）。

- **移除调色盘、五次大幅扩展预设主题色与字体**：设置面板「主题色」分区移除 HSV 浮动调色盘，简化为纯预设色点环；**主题色从 15 档扩至 541 档**。分五批扩充：第一批（+20）：粉红 / 薰衣草 / 金盏 / 深青 / 石绿 / 橄榄绿 / 番茄红 / 铁锈橙 / 薄荷绿 / 松石蓝 / 石灰 / 暖灰 / 冷灰 / 烟灰 / 炭灰 / 松露棕 / 紫藤 / 浆果红 / 海蓝 / 松绿；第二批（+10）：深夜蓝 / 深靛蓝 / 暖棕 / 深洋红 / 海沫绿 / 灰绿 / 酒红 / 蜜金 / 柔薰衣 / 森林绿；第三批（+10）：**猩红** / **砖红** / **巧克力** / **钴蓝** / **天青绿** / **暖杏** / **银灰** / **海军蓝** / **翡翠绿** / **象牙白**；第四批（+45）：**瓷青绿 / 浅粉 / 蜜桃 / 暖黄 / 鼠尾草绿 / 深青色 / 深青(二) / 蔚蓝色 / 苍蓝字 / 粉蓝 / 天青 / 矢车菊蓝 / 皇家蓝 / 石板蓝 / 薰衣草粉 / 蔷薇雾 / 胭脂粉 / 鲑鱼红 / 暗紫兰 / 兰花紫 / 梅子红 / 蓟草紫 / 淡紫红 / 钢蓝 / 军校蓝 / 海蓝宝石 + 长春花蓝等全谱系色彩**；第五批（+396）：柔和淡彩 20 档 / 明亮霓虹 15 档 / 深色大地 15 档 / 暖色陶土 10 档 / 冷色石板 10 档 / 浆果酒红 10 档 / 深林绿 10 档 / 天空青色 15 档 / 珊瑚蜜桃 10 档 / 奶油象牙 10 档 / 薰衣草紫罗兰 15 档 / 薄荷海沫 10 档 / 金色琥珀 10 档 / 玫瑰粉色 10 档 / 深红猩红 10 档 / 橄榄深绿 10 档 / 深海军钴蓝 10 档 / 钢铁工业 10 档 / 暖灰棕灰 10 档 / 亮黄柠檬 10 档 / 橙铜 10 档 / 青蓝绿 10 档 / 梅子紫 10 档 / 珊瑚桃 10 档 / 棕褐色调 10 档 / 大地沙 10 档 / 灰调 10 档 / 粉彩 10 档 / 金属色 10 档 / 花卉自然 10 档 / 食物色调 10 档 / 节日季节 10 档 / 补充 10 档。**「界面字体」**从 20 档扩至 75 档**，四批扩充（详见下方）。同步清理调色盘全部关联代码（约 285 行）。

- **Actions 日志标注站点来源**：每轮采集收尾逐条打印全部线路——营运公司 / 线路号 / 「正在使用高德地图站点数据信息」或「无高德站点数据，正在使用 OSRM 兜底」/ 信息存储文件名（`bNN.json`）；抬头明确「每次执行 Actions 都重新获取全部线路站点信息」。同步导出 `reports/osrm-lines.json`（当前 366 条 OSRM 兜底线路），随 `reports` 一起提交，排查走向问题先查该清单
- **646 路走向不完整（多次返修）**：根因是资产只有 24/25 站、丢了「官堤路公交场站」；用 `AMAP_KEY` 走 `inputtips → lineid` 链路重采，现双方向 36/35 站、首末站与 polyline 端点 0m 吻合，地图显示完整走向
- **全市两浮窗常驻 + 位置/状态记忆**：车速榜、自编号查车默认打开（只有 ✕ 显式关闭才隐藏），标题栏 grip 可拖动（`utils/panelPos.js` 的 `bindFloatDrag`，只绑手柄不误触按钮/输入）；开关、折叠、位置、输入、档位全部 localStorage，二次进入或重载恢复上次位置与状态。拖动过的窗格自动解除「上下错开」约束自由摆放
- **线路榜改为输入线路号**：单车榜 / 线路榜切换；线路榜输入线路号（337 / 337路 / code 内嵌号精确匹配，不再误命 D337）→ `fetchLineVehicles()` 只请求该线路各方向（1~2 个 `/detailData`，不触发全网 1500+ 扫描），列出该线路在运车辆按车速从高到低排序；重复点「查询」只重拉当前线路，标题显示「单线查询」时刻
- **查无此线不再卡「正在加载」**：新增 `stopsLoaded` 标记区分「仍在加载」「查无此线（已加载完但无数据）」「未输入」，不存在的线路显示「未查询到『线路号』路的线路走向，请检查线路号」
- **全市卡顿优化**：拖拽 / 滚轮 / 双指的高频重绘用 `requestAnimationFrame` 合并（每帧最多一次全量投影），`renderCityNet` 上万点 SVG 拼接用 `Math.round(v*10)/10` 替代 `toFixed(1)`，卸载时取消待执行帧
- **高德 KEY 改为双输入框 + 生效修复**：设置面板把「Key」和「安全密钥」拆成两个独立输入框（各自显隐眼睛），`settings.js` 的 `getAmapKeyPair()`/`setAmapKeyPair()` 成对读写、存储仍用 `key,secret` 兼容旧格式；修复换 KEY 不生效（旧 `window.AMap` 未清导致新 KEY 被吞，现按 `window.__whbisAmapKey` 判定并重新注入）；LineSearch 平台不匹配（Web服务 Key 用在 JS API 报 `USERKEY_PLAT_NOMATCH`）不再静默，弹明确提示；面板文案注明必须「Web端(JS API)」类型 Key
- **线路榜单线查询失败不再误显示「无在运车辆」**：点「查询」时若该线路各方向 `/detailData` 全部失败且一辆车都没拿到（上游超时/断连），判定为请求失败而非真没车——**保留上次成功结果**、弹「单线查询失败，保留上次结果，请重试」，不把好数据替换成空；只有请求真成功返回 0 辆才显示无车；首次就没成功过时回退全市快照过滤。避免「第一次快照有车、点查询反而没车」的误判
- **AGENTS.md 重构更新**：按当前代码状态重写——修正过时描述（页面只剩 `login`/`map`、`DIR_STYLE` 在 `LineMap.vue`、`lineCode`≠线路号、OSRM 旧缓存键已废弃、BYOK 未整体移除而是用于自绘模式官方轨迹）、新增「交付约定」（改完自动同步 README + 提交推送三分支 + merge CI 采集分叉）、高德 KEY 双输入框与类型坑、全市两窗常驻/位置记忆、线路榜单线查询与失败回退、查无此线、卡顿优化、Actions 站点来源日志与 646 修复经验；避免后续按旧条目改出新问题
- **流畅度优化**：用 CDP 实测定位而非盲改——① `renderTiles()` 给瓦片数组加内容签名（`key@left,top,size`），微小平移/非相机重绘时保留旧数组引用，避免 Vue 每帧 diff/重建全部 `<image>`（实测相机不变连绘 30 次引用保持 30/30，关/开底图签名清空保证重显）；② 面板拖动的 `measureUi()`（6 次 `boundingClientRect` 强制 layout）经 `scheduleMeasure()` 用 rAF 合并到每帧一次（实测拖 20 次只量 1 次），卸载时取消待执行帧；③ `busId.js` 分片构建把 `for i<=end` 改为半开区间 `<end`，修掉每片边界重复算 MD5。功能回归：线路视图站点/车辆/瓦片/站名、全市视图 300 车聚合均正常，三项单测全过
- **自编号查车多结果改为面板内滚动**：此前默认 `.os-body` / `.os-list` 没有 flex 收缩约束（只有 `.with-rank` 变体有），结果多时列表撑破面板 `max-height:58vh` 溢出屏幕；把默认规则改成与车速榜 `.rank-body`/`.rank-list` 同口径（`.os-body` flex:1 + min-height:0、`.os-list` flex:1 1 auto + min-height:0 + overflow-y:auto），不再固定 520rpx。窄屏实测 12 条结果面板底 666 < 视口 707，列表内部 171px 滚动区可滚（scrollHeight 1012），与车速榜共存时也不溢出
- **全市线网视觉分层（不再杂乱）**：控制卡新增「线网·精简 / 全部 / 关闭」三态按钮（`whbis:city-net-mode` 持久化）。精简（默认）：淡色全网纹理打底（2 条合并路径 w1.2/op0.22）+ 只突出站数最多的前 90 条主干（w2.6/op0.85），层次分明；全部：旧口径逐条最多 260 条 w4/op1；关闭：只画车点不画线网。远景（zoom<12.6）只有淡纹理层，不再重复逐条画；筛选线路号时一律逐条加重该线。原生 `<map>` 模式同样遵循三态（精简取主干 ≤90、关闭不绘）。CDP 实测：zoom13.5 精简 90 条 / 全部 260 条 / 关闭 0 条，按钮循环与持久化正确，DOM path 描边参数生效
- **线网「飞线」根因修复**：截图里横穿湖泊的笔直长线不是视觉问题而是数据缺陷——`network.json` 站序里有 1518 段 >1.5km 跳变（287 路单段 79km 跳到广东、D650 等定制线跨城 50km）。`utils/cityBus.js` 的 `normalizeNet()` 加载时按相邻站距切段：方向拆成 `parts:[from,to]` 多段，跳变处各段独立起笔不硬连；孤立坏点（如 287 路夹在中间的 113.80/30.21）直接丢弃；2 点跨城 / 全跳变凑不出连续段的定制线标 `suspect`，渲染成极淡虚线（`3 4`）作为「这条线存在但坐标不可信」提示，**不再整条丢弃导致有站没线连**；重算剔除坏点后的包围盒避免全览缩放被拽飞。⚠ **阈值 8km**（非 2.5km）：武汉郊区线/快线相邻站 2.5~8km 属正常（全库 584 段），2.5km 会把大量正常线路切碎；8km 仍拦住全部 >20km 跨城飞线却只影响 44 段。自绘（`pathOf` 逐段 M）与原生（`cityNativeNet` 逐段 polyline + `dottedLine`）都按 `parts` 渲染。实测：1129 方向 → 1097（32 条畸形标 suspect 不丢）、44 条拆段、段内 >8km 跳变残留 **0**
- **线网远景不再"有站没线连"**：上一版 lite 模式远景（zoom<12.6）只画 2 条合并淡纹理（op 0.22），90 条主干因 `drawIndividual` 条件被跳过，概览时几乎看不到线。修正为 `drawIndividual = filtered || !fuse || cityNetMode==='lite'`——lite 任意缩放都画 90 条主干（op 0.85），淡纹理只做背景；full 远景仍只画纹理避免 1000+ 条糊屏。CDP 实测 zoom 10.5~15 全部 90 条主干可见（DOM visible=90）
- **CI 采集频率改为每 2 小时 + 高德步骤改为全量重拉**：`.github/workflows/daily-collect.yml` cron 从 `*/37 * * * *`（每 37 分钟）改为 `0 */2 * * *`（每 2 小时整点触发）。`scripts/auto-collect.mjs` 高德相关步骤同步改造：「高德官方轨迹」从 `--only-changed scripts/.changed-lines.txt`（仅重拉站点变化的线路）改为 `--force`（跳过进度台账，对整个武汉公交系统的每条线路、每个方向重新拉取高德官方轨迹与站点数据）；「高德站点补齐」从 `--max-lines 60`（每轮限量 60 条）改为不限量（`--backfill-stops` 一轮扫完所有「source 已是 amap 但站点还是集团 MD5 站号」的半成品线路）。确保每次调用高德免 Key 方案时都将全部线路的站点信息重新获取。同步更新 `scan-routes-amap.mjs` 头注释（频率 6h→2h、增量→全量说明）、README 更新日志与 AGENTS.md 对应条目

### 2026-11-20

- **采集频率 6 小时 → 2 小时**：`.github/workflows/daily-collect.yml` cron 改为 `0 */2 * * *`（每 2 小时整点触发一次）
- **收录 18 条 H 系惠民公交**：H81~H99（后端本无 H95），对外显示号 H81 / 内部编码 81，`scan-lines.mjs` 白名单放行 H 前缀；修复重复查询与手动输入时对外号退回内部码（`81`→`H81`）的 bug
- **完整自编号显示**：新增 `scan-busnumber.mjs` 从 buspedia 车队页采集团全部车型，**131 车型有数据 / 613 编号段 / 18614 个完整编号** → `src/static/data/bus-number-map.json`；前端 `busNumber.js` 懒加载映射表，把还原出的纯数字（如 `32379`）补全为完整形式（`319N2379`）；原始纯数字保留供 MD5 反查，车速榜 / 地图页 / 站点页 / 发车时刻共 9 处显示接入
- **编号映射规则修正**：系统编号 = 公司号(首位) + 车号（如 `3`+`2379`=`32379`），buspedia 完整编号 = 公司号 + 批次码(1~2位) + 车型字母 + 车号（如 `319N2379`）；映射按「公司号+车号」对应，非简单去字母。修复解析正则（批次码不限 `25`、支持 `15Y`/`105A`/`16Y` 等全部格式）与车号前导零保留，避免 `32210` 被误匹配为 `322N10`
- **多年份编号段全量采集**：车型页按年份批次分多列（2015/2017/2018/2019…），旧版只取第一个 `.data-cell`（漏掉新年份）；改为抓所有含编号段特征的 `.data-cell`（`networkidle` + evaluate 重试应对二次重定向），段行数 440 → 613、完整编号 11936 → 18614
- **新旧年份冲突规则**：同一系统编号（公司号+车号）在不同年份批次重复时，**批次码大（年份新）的优先**，映射数组按批次码降序排列（前端取 `arr[0]`）；如 `107E1314`(批次07) 与 `117E1314`(批次17) 以 `117E1314` 为准
- **buspedia 采集登录态**：`scan-busnumber.mjs` 用 Playwright + Edge 登录（账号走 `BP_USER`/`BP_PASS` 环境变量），Cookie/localStorage token 落 `scripts/.buspedia-state.json`（已 gitignore），页面二次重定向需 `networkidle` + evaluate 重试才抓得到车队数据
- **全市面板重构**（`LineMap.vue`）：控制卡收敛为「信息区 + 一排数据操作」，缩放 / 全览 / 站名 / 底图移入地图右下角浮动工具条（`.view-tools-float`），全市态与线路态共用；「自编号」开关更名「编号标签」与查车功能区分；控制卡变矮后 `fitRect` 按实测 bottom 计算，地图可视区更大
- **车速榜 UI 重设计 + 复制**（`SpeedRank.vue`）：每行由三行压成两行（线路/方向/自编号 + 走向·公司·时刻），公司名缩写（`武汉公交集团第一公司`→`一公司`）；车速数字统一主题高亮、快慢改由左侧分档色条表达，消除满屏红字的报警感；标题栏接入 `CopyPill` 复制胶囊，文字 / Excel / 图片三档与全站共享设置，复用 `copyTable`
- **自编号查车支持尾号模糊匹配**（`cityBus.js` 的 `searchBusesByOrgSuffix()`）：取输入末尾连续数字作尾号（`321B2426`→`2426`、`325F311`→`311`、`426`→`426`），对全市快照所有车辆的纯数字 `orgId` 做 `endsWith`，**跨所有公司**命中后四位 / 后三位；浮窗改为输入即查、实时呈现的多结果滚动列表（线路/方向/完整自编号/走向/车速/公司），点行选中车辆并定位；仍需至少 2 位数字，不另发请求
- **自编号查车面板加入复制**：结果计数行接入 `CopyPill`（文字 / Excel / 图片三档），内容为线路号 / 营运公司 / 所处站点 / 自编号 / 上下行五列；「所处站点」按命中车辆的线路号异步加载站点明细（`loadLineAsset` + `assetDir`，按线路去重 + in-flight 缓存），用 GPS 最近邻算站名并回填结果行，数据预取到缓存后再复制，保证图片/Excel 富格式在手势栈内同步写入不被浏览器拒绝；复制到计数行而非头部，避免标题挤压
- **复制图片字体跟随界面字体**：`settings.js` 抽出 `getFontFamily()`（与 `applyFont` 写入 `--app-font` 的值逐字一致），`clipboard.js` 的 `renderTablePng` 标题/正文/页脚统一复用，复制图片与「账号与设置 → 界面字体」完全一致；全站所有复制图片入口一并生效
- **在线车辆复制「所在站点」改正**：`LineMap.vue` 的 `nearStopOf()` 原返回含坐标的多行文本、被当单元格塞进复制表格破坏 TSV 结构；重构为只返回 K-d Tree 最近一站的**站名**，悬浮提示 `busTip` 仍保留独立坐标行；与 `LineStops.vue` 口径统一
- **README 同步更新**：按实际落地修正 —— 移除已废弃的 BYOK 过时描述（`amap_byok_config` / `map_render_mode` / `hasMapKey()` / `applyAmapConfig()`），重写地图模式说明为单一真值 `useNativeMap()`（App 端内置 Key → 原生 `<map>`，H5 现状无 Key → 自绘走向图）；修正分支约守（源码分支严禁推远端）；目录结构按当前资产重绘（`pages/login/login`、utils/scripts 新增补齐，`index`/`line`/`settings` 页已移除，`components/` 新增）

### 2026-11-15

- **营运公司采集双链路**：`scan-org.mjs` 从 buspedia 采集团线路 `org`（含人工核实映射 355/408=一公司，重跑不丢）；新增 `scan-org-live.mjs` 从在线车辆自编号反推（MD5 还原首位数字 1→一公司…9→九公司，按线路投票取众数），补 buspedia 未收录的 D/K/YX 线，接入 `auto-collect.mjs` 每 6 小时随 CI 累积回填。全库 `org` 570 → 604 条
- **931 路标记停运**：用户核实已取消，`status=停运` + `statusSource=人工确认`，不再进入实时查询 / 搜索联想 / 全市线网扫描
- **算路算法优化全集**：新增 K-d Tree 空间索引（O(log N) 替换 O(N) 最近站点扫描）、公交方向判定（航向 × 段向余弦相似度，60° 阈值）、bbox 长宽比过滤（剔除跨城大线假阳性）、route 几何质量评分（多指标合并）
- **CI 构建修复**：`auto-collect.mjs` 构建步骤改为 `execFileSync(NPM, ...)` 直接调用，修复 `node npm run build:h5` 报错
- **站点信息徽标**：换乘卡片线路号后方插入所属公司徽标（公交集团 / 蔡城 / 木兰 / 汉奇）
- **环形线路 UI 补齐**：实时线路页徽标 / 方向分段 / 极简标签 / 极简按钮四套 `.loop` 紫罗兰色样式
- **修复重复 import 导致构建失败**：`LineMap.vue` 删除重复的 `kdtreeBuild` / `kdtreeNearest` / `estimateDirection` import

### 2026-11-14

- CI 采集流程修复：`git add` 改用 `fs.existsSync` 过滤缺失路径、detached HEAD 下 `git push` 改用显式分支引用
- `scan-poi-newbus` 对齐 ditu.amap.com + SSR 补充字段，`AMAP_KEY` 环境变量解耦

### 2026-11-13

- **记住我**功能 + OSRM map-matching 走向改进 + 每日自动采集流水线（GitHub Actions + Pages）
- 408 内外环线路漏采 + 闭环走向退化修复
- `getPoiNewbus` 兼容模式与 `amap.id` 全量回填

### 2026-11-12

- **就地下拉全局互斥**：`utils/dropdown.js` 统一仲裁器，复制胶囊 / 刷新间隔下拉 / 搜索联想面板统一接入
- 复制菜单改为胶囊正下方绝对定位
- 右下角「更新」按钮默认贴边隐藏并加亮边，新增「更新信息」入口
- 停运线路状态修正 + 走向绘制偏离修复

### 2026-11-11

- 新增高德网页端站点采集器（B 方案），补全 60 个线路方向
- 远端自动补全 9 个高德走向方向（7 个分片 + manifest + 台账）

### 2026-11-10

- CI 定时窗口改为北京时间 03:20 / 周一 04:40
- CI 失败也提交台账防重复采集；每周重试未命中；新增台账自检
- CI checkout 使用全量历史，避免浅克隆推送被拒
- CI schedule 事件下显式放行采集/清单/提交步骤
- 采集器支持 `--max-lines` / CI 日志，清单生成幂等

### 2026-11-09

- 高德 Key 明文从 TODO.md 移除，改用环境变量 / GitHub Secrets 注入
- 新增 turbo 账号、面板标题优化、高德采集断点续跑与备用链路，补齐 371 个 amap 方向
- 站点详情面板标题站名加宽至 880rpx，预留 40 字宽度避免过早省略

### 2026-11-08

- 公交站牌仿真图与交互增强
- 统一全站滚动条风格；修复面板尺寸记忆持久化

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

### 常用命令速查

| 命令 | 作用 | 产物位置 |
| ---- | ---- | -------- |
| `npm run dev:h5` | 启动网页版开发服务器 | 内存（热更新） |
| `npm run build:h5` | 构建网页版 | `dist/build/h5` |
| `npm run build:app` | 构建 Android App 资源 | `dist/build/app` |
| （Vercel 自动） | `main` push 触发构建部署到 `boundless-whbis.vercel.app` | — |
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