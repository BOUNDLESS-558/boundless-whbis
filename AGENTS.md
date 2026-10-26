# AGENTS.md — 武汉公交信息实时查询（WuhanBus）

uni-app（Vue 3 + Vite 5）跨端应用：H5 网页版 + Android App，查询武汉公交线路、站点、时刻表、实时车辆。
**有 Git 仓库（main 分支），远程为 `origin` = `https://github.com/BOUNDLESS-558/boundless-whbis.git`**，没有 CI / lint / typecheck，唯一可执行的验证手段是下面的两个 Node 测试。
提交前注意：`src/config.js` 的 openId 为占位值可入库；`apiProxy`（Cloudflare Worker 地址）与地图高德 Key 均不涉密，也可入库。若将来填入真实密钥/Key，务必先加入 `.gitignore` 或改为环境注入。

## 命令（已实测可用）

```bash
npm run dev:h5       # 开发服务器 http://localhost:5173，自带 /api 跨域代理
npm run build:h5     # H5 产物 → dist/build/h5
npm run build:app    # App 资源 → dist/build/app（之后需 HBuilderX 云打包，无法纯 CLI 出包）
npm run test:md5     # MD5 实现单测（RFC 1321 向量 + 实测对照）
npm run test:busid   # 车辆编号还原测试（全量建字典约 400ms）
npm run deploy:pages # 构建 H5 并推送到远端 pages 分支（GitHub Pages）
```

- 两个测试都是 `node scripts/*.mjs`，失败时退出码非 0，可直接当 CI 用。
- 运行时会出现 `MODULE_TYPELESS_PACKAGE_JSON` 警告（package.json 无 `"type": "module"`），**无害**，勿为此改 package.json——会破坏 uni-app 工具链。
- 改完 `src/utils/md5.js` 或 `src/utils/busId.js` 后务必跑这两个测试。
- `deploy:pages` 需要 git 代理环境变量 `GIT_HTTP_PROXY`（默认 `http://127.0.0.1:7890`），推远端 `origin/pages`；详见 `scripts/deploy-pages.mjs`。
- 地图相关回归用 CDP 探针（需先 `npm run dev:h5`，端口可能自动顺延到 5174/5175，用 `PROBE_BASE` 或命令行参数传真实地址）：
  - `node scripts/probe-osrm-visual.mjs 337 40 [--mobile]`：先清旧缓存再等吸附，读 localStorage 里的走向几何，统计点数/总长/大缺口，导出 `.openchamber/geom-337.json`，并输出带底图、纯走向（关底图）和按站名拉近的 `osrm-focus<N>-*.jpg` 截图（`FOCUS="站名1|站名2"` 可指定要看哪一段）。
  - `node scripts/probe-roadfit.mjs .openchamber/geom-337.json 80`：**贴路体检**——把最终走向按 80m 加密后喂 OSRM `/match`，报每点离路的距离分位数与贴不上路的点数。判据：中位数 0~2m、P90 ≤5m、贴不上路 0 点才算真的贴路；出现大量 40m+ 或 unmatched 就是有直线弦横穿街区。
  - `node scripts/probe-nearest.mjs 337 0`：坏段诊断——列出每个端点最近的 3 条路（含 name）并两两规划，用来确认是不是「站点被吸附到高架层/对向车道」。
  - `node scripts/probe-alt-routes.mjs 337 0`：比 project-osrm 与 FOSSGIS 两套服务 + `alternatives` 备选路线（实测两者数据同源、备选只有一条，无额外价值）。
  - `node scripts/probe-label-overlap.mjs "<url>" 30 [--mobile]`：站名/车号/车辆圆点两两重叠体检，四类重叠全为空才算通过。
  - `node scripts/probe-line-colors.mjs 337`：详情页方向配色体检，自动点「上行/下行」各截一张图，并读回线路带 `.seg` / 站点圆点 / 方向页签的**计算样式**（CSS 变量是否真的解析出方向色）。需 dev server 端口时用 `PROBE_BASE` 传。
  - 同上的 `probe-osrm-visual.mjs` 末尾还会求值 `vm.polylines`（无 Key 时 `<map>` 不渲染但 computed 仍可算），核对原生地图那套「白色外描边在前、方向色主线在后」的层序，以及 `gapUp/gapDown ≈ 14`（米）确认双轨偏移生效。
  - `node scripts/probe-osrm-legs.mjs 337 0`：逐段 ratio / 垂距明细，调 OSRM 判定阈值时用。

## 接口协议（最容易做错，三条铁律）

后端 `https://customized.wuhanbus.com/gps-resapi/wechat/bus`，完整文档见 `武汉公交信息实时查询API接口文档.md`（UTF-8）。

1. 必须 `POST + application/json`，GET 不支持。
2. **`openId` 必须放请求头**；放 query / body 一律返回 `90001 缺少openId`。其**值不被服务端校验**，`src/config.js` 里的任意非空字符串即可，不要花时间去找"真实 openId"。
3. `/line` 传 `lineCode`，`/detailPlanTime` 与 `/detailData` 传 `lineId`（用错参数名报 `3014`）。两者格式相同：`{cityCode}-{线路号}-{方向0|1}`，由 `config.js` 的 `buildLineCode()` 生成。

响应解包判据：`payload.success === true && payload.msg.code === '20000'`（见 `src/utils/api.js` 的 `post()`）。
后端怪癖：响应里的 `direction` 字段与请求方向**相反**，一律以请求时的编码 / `stopDetailList` 顺序为准。

## 架构要点（文件名看不出来的）

- 四个页面：`pages/index/index.vue`（搜索 + 地图设置入口）→ `pages/line/line.vue`（详情，最复杂）→ `pages/map/map.vue`（地图），另有 `pages/settings/settings.vue`（地图服务设置 BYOK）。页面间靠 **URL query 传参**（lineCode/direction/lineName/startStop/endStop），改跳转参数要同步改对端 `onLoad`。
- `utils/api.js` 用 uni-app 条件编译 `#ifdef H5` 切换 base：**H5 dev 走 `/api` 前缀**（仅 dev 有 Vite 代理），App 直连真实域名。**H5 生产走 `APP_CONFIG.apiProxy`**（Cloudflare Worker 反代，见 `deploy/cloudflare-worker.js`），因为 GitHub Pages 等纯静态托管直连会被上游 CORS 预检拦截；`apiProxy` 留空才回退直连。
- `utils/busId.js`：接口的 `busId = MD5(自编号)`，通过枚举 0~200000 建反查字典。为不卡 UI 采用分片异步（每片 8000 + `setTimeout`），**字典就绪前 `decryptBusId()` 返回 null**，页面必须用 `onBusIdReady(cb)` 二次刷新。循环终止条件必须用 `end >= DICT_MAX`，改成 `n <= DICT_MAX` 会在 `n == DICT_MAX` 死循环。
- `utils/geo.js`：Haversine 距离 + 车辆匹配最近站点；详情页的"线路走向总览"按**沿线累计里程比例**定位站点，不是等距。⚠️ 接口返回的坐标已是 **GCJ-02**，直接上高德即可，勿调用 `wgs84ToGcj02()` 二次转换。
- 地图页双模式由 `config.js` 的 `hasMapKey()` 决定（综合内置 `mapKey` 与用户自定义 BYOK 高德 Key）：**无可用 Key（默认）走自绘 SVG 走向图**，有 Key 才渲染原生 `<map>`。项目**不再内置高德 Key**，用户经首页 ⚙ 或 `settings` 页自填（存 localStorage，`applyAmapConfig()` 运行时覆写 `__uniConfig.aMapKey`）。改地图相关代码要两种模式都验证。
- 无 Key 模式的两个底座（都只走自绘 `<svg>`，与高德 JS API 无关）：
  - **底图**：`map.vue` 的 `.tile-layer` 用 `<image>` 拼高德标准瓦片（`webrd0{1-4}.is.autonavi.com/appmaptile?...style=8&x=&y=&z=`，免 Key、GCJ-02、256px），按相机浮点 zoom 取 `zt=floor(zoom)` + `scale=2^(zoom-zt)` 定位；瓦片层再加 `.tile-shade` 暗色蒙版 + `filter` 降饱和，保证白字站名/车号可读。控制卡「底图」开关可关。
  - **走向**：`utils/osrm.js` 调 OSRM（`router.project-osrm.org`，WGS-84）把站点序列吸附到 OSM 道路，坐标需 GCJ-02 ⇄ WGS-84 互转（`geo.js` 的 `gcj02ToWgs84`）。逐段质检用**最大垂距**（几何点偏离起终点连线的最大值），不要用「规划距离/直线距离」的 ratio——站前掉头 ratio 能到 11 但实际只偏 76m，而吸附到高架 ratio 17 时已跑到 3km 外。
  - **坏段修复梯次（四级，别只做前两级）**：① 贴走廊直接用 → ② 加 1/3、2/3 途经点重算 → ③ **换端点吸附候选重算**（`/nearest?number=3` 取站点附近 3 条路，按吸附距离升序两两规划，≤6 组、整线 ≤5 段）→ ④ 站间短直线。
    - ③ 是 2026-10-26 实测出来的关键一手：坏段的根因是站点被吸到**高架层或对向车道**，OSRM 只能绕远路上的匝道（龙阳大道升官渡→四新大道 551m 站距被规划成 9.51km）。换到邻近车道路面后 6 个坏段里 5 个恢复正常（1.30km→0.15km、1.12km→0.25km 等），整线只剩 1 段短直线。
    - ③ 的两个防坑：吸附点离站点 >60m 不认（那是隔壁街，不是同路另一车道）；两个吸附点挤到一起时走向长度会接近 0，必须用 `distance >= straight * 0.8` 剔除「跳过」而非「绕开」。
    - 已试过且无效、不要再走的路：`exclude=motorway`（demo 报 InvalidValue）、`alternatives=3`（只回 1 条）、foot/walking profile（几何与 car 完全相同）、FOSSGIS `routing.openstreetmap.de`（与 project-osrm 数据同源、结果一致）。
    - 结果按 `${线路号}-${方向}` 缓存 7 天（`whbis:osrm-route:v5:`，算法改了要升版本号，**升版本后旧键不会自动清理**，探针需先清 localStorage）。OSRM 是公共 demo 服务器，会限速甚至断连，全部失败仅回退站点连线，不影响主流程。
  - **“免 Key 拿高德官方轨迹”三条路已实测关闭，不要重试**（可跑 `scripts/probe-embed-and-exclude.mjs` 复验）：① iframe 嵌入高德线路页——该页**没有** `X-Frame-Options`/CSP，确实能嵌，但跨域读不到 DOM、接口无 CORS，拿不到折线坐标，也无法同步相机把车辆画上去（跟登不登录无关：不登录也能看到线路图）；② 直拉 `amap.com/service/poiInfo` / `ssr/search/busline_detail`——无浏览器指纹时只回 SPA 外壳 HTML（84KB，无 xs/ys）；③ OSM 公交 relation——武汉 0 条。真要 100% 官方走向，只有用户自填高德 JS Key 走 `AMap.LineSearch`（`planRouteAlongRoads()` 已实现）。
- **方向配色是全站约定，两页必须一致**：`map.vue` 的 `DIR_STYLE` 是唯一真源——**上行 = 青蓝（#06B6D4 / #22D3EE）、下行 = 玫红（#F43F5E / #FB7185）**，`line.vue` 用 `.dir-up` / `.dir-down` 上的 CSS 变量镜像同一套色（改色要两处一起改，历史上这两页一个用青一个用靛蓝，上下行根本对不上）。选青/玫红而非红/绿是为了色盲友好，且在浅色高德底图与深色自绘画布上都清晰。
  - **上下行同屏必须“分轨”**：两条轨迹在多数街道上几乎完全重合，后画的会整条盖掉先画的（看起来就像只有一个方向）。因此：自绘 SVG 在投影后按行进法向各偏 3.5px（`renderSchematic` 的 `sideShift`，屏幕像素以 zoom 无关）；原生地图在 `polylines()` 里调 `offsetPolyline()` 沿行进右侧各偏 14m（经纬度局部平面近似）。
  - **原生地图折线的层序与属性**：先把两个方向的白色外描边（width 9）铺完，再画两条方向色主线（width 5），否则粗外描边会盖住对方主线；下行主线用 `dottedLine: true`（uni-h5 会转成 `strokeDashStyle:'dash'`）。⚠️ **H5 端 `arrowLine` 是个空属性**（uni-h5 只声明未传给 AMap，只有 App/小程序生效），别指望地图上有方向箭头；折线 `color` 只接受 `#RGB/#RGBA/#RRGGBB/#RRGGBBAA` 十六进制（uni-h5 的 `hexToRgba` 不认 `rgba()` 字符串），而 callout 的 `bgColor` 反过来只认 `rgba()`。
  - 车辆圆点与主线同色系但提亮一档（`#67E8F9` / `#FDA4AF`）并**统一加白色描边**，否则在同色走向线上会融成一团；地铁换乘标签（`.ttag`）已改紫色，就是为了不跟上行青蓝撞色。
  - **原生地图的 `markertap` 参数在 `e.detail` 里**：uni-h5 的 `normalizeCustomEvent()` 只返回 `{ type, timeStamp, target, currentTarget, detail }`，**没有** 扁平化的 `markerId`。历史代码写 `e.markerId`（小程序的写法）恒为 `undefined`，导致“点车辆图标完全没反应”而无人报错。`onMarkerTap` 现已兼容两种形状：`const id = Number(e.detail?.markerId ?? e.markerId)`。同理，其它地图/组件自定义事件（`regionchange` 等）一律从 `e.detail` 取。
  - 车辆图标**单击或双击都弹出详情窗**（双击就是连点两次，第一下就已打开）；站点标记（id 5000 段）只弹 toast，不开窗。各入口（地图标记 / 示意图车点 / 右侧列表项）统一走 `selectBus()`。
  - **marker 一定不能传 `title`**：uni-h5 的 `MapMarker` 把 `title` 当 callout 内容建一个隐藏气泡（`if (calloutOpt.content || title)`），但它的 click 监听会 `callout.visible = !callout.visible` —— 结果就是**每点一次车图标，车头上方冒出一个“337 3240”白框**（盖住底图，重建地图才消失）。去掉 `title`、也不挂 `callout`，车辆信息只在详情浮窗里看；站名继续用 `label`（站点 `title` 同理已删，否则点站点也会多一个重名白框）。
  - **车辆信息不得常驻地图**：marker **不挂 `callout`**（旧版常驻气泡会盖住底图与站名），自绘走向图的车号标签也只在选中时显示（`selectedBus === b`）。线路号/自编号/上下行/车速/公司这些信息只在用户**主动点击车辆图标**后于详情浮窗展示。方向徽标文字写全「上行 / 下行」，不要缩成「上 / 下」。
  - 左上控制卡的 `.ctrl-dir` 是**单行**（`flex-wrap: nowrap`）：全部 / 上行 / 下行 / 337 路 / 营运公司徽标必须同一排，徽标紧跟线路号后面。千万别改回 `wrap` 或给 `.ctrl-org` 加 `margin-left: auto`——那样徽标会掉到第二排最右，看着像错位。空间不够时靠 `.org-name` 的 `text-overflow: ellipsis` 截断（徽标里用短名 `第三公司`，全名 `武汉公交集团第三营运公司` 放在 `title` 与车辆详情窗）。`.dir-tab` 用 `height + inline-flex 双轴居中`，不能只靠 padding——中文基线会偏，且选中加粗后文字会上下跳。
- 站名标签：窄屏（canvas < 600px）按 `stride` 抽稀（约 10 个候选）并放宽 zoom 门槛到 10.5，否则 29 个站名在 390px 里会全部碰撞丢弃只剩首末站；首末站恒显示，碰撞时上下微移。
- 走向未贴路时（初屏那几秒 / OSRM 失败）画的是**站间直连**，因此用 `routeState` + `routeAlert` 把它显式标成“贴路计算中 / 贴路服务不可用”，并画细虚线 + 半透明。看截图判断走向对错前，先确认已吸附完成（缓存键已落库、无 alert），别把初屏直连当成最终结果。
- 详情页实时数据 `setInterval` 每 15 秒刷新，清理在 `onUnload`；新增异步任务时同样要在这里收尾。
- **车辆详情是“可拖动浮窗”，不是底部弹层**（`map.vue` 的 `.bus-sheet`）：无全屏遮罩（开着也能拖地图）、标题栏即拖动手柄、`📌` 固定位置（锁住拖动）、`✕` 关闭。底部只留「在地图上定位」，没有「关闭」按钮。
  - 拖动位置的 `sheetPos` 是 **px 绝对坐标**（`sheetStyle` 直接把 `left/top` 写入，`bottom:auto; transform:none` 覆盖默认的居中贴底），每次移动都过 `clampSheet()` 夹在视口内（留 6px），`window.resize` 时也要重夹一次，否则拖出屏幕就找不回来。
  - 事件分两路：**触摸走模板 `@touchstart/@touchmove/@touchend`**（touch 会重定向到起始元素，手指移出标题栏也能继续拖）；**鼠标必须原生监听**——`bindSheetDrag()` 在 `watch.selectedBus` 里 `$nextTick` 后给 `.sheet-head` 挂 `mousedown`，并在按下时把 `mousemove/mouseup` 挂到 `document`（uni-app H5 对 view 的 mouse 事件绑定不可靠）。收尾在 `onUnload` 调 `unbindSheetDrag()`。
  - 拖动结束的 120ms 内用 `_suppressSheetClick` 屏蔽 `📌`/`✕` 的 click，否则松手落在按钮上会误触发。
- **悬停显示自编号 / 「在地图上定位」**（`map.vue`）：
  - 原生地图的 marker 没有任何可挂的 hover 事件（`title` 也不行，会被 uni-h5 变成点击开关的 callout）。做法是自己做命中判定：`mousemove` 挂在容器（`uni-map` / `.schematic`）上，用 `_projectTo()` 把车辆经纬度按 **Web Mercator 正投影**换算成容器像素，距离 < 18px 即命中。原生模式的投影参数取 `@regionchange` 记下的 `_view`（回退 `mapCenter`/`mapScale`），自绘模式用 `cam`/`projCenter`——两边公式一致，不要只实现一边。
  - 浮标 `.bus-hover` 只在鼠标悬停时存在，离开 / 拖地图 / 列表为空时立即置空（量在 1px 内的移动不重复赋值，否则 `mousemove` 每帧都会触发重渲染）。浮标位置相对 `.page` 算，离圆点上方 20px（原生图标底边即坐标点，所以是 42px）。
  - `focusBus()` 是**真定位**：`ZOOM` 直接上顶（原生 18 / 自绘 18.5），自绘模式把 `cam` 对准车辆、`projCenter` 复位到容器中心；原生模式要**同时**写 `mapCenter` / `mapScale` / `_view`，否则下一轮 silent 刷新会把画面拽回去。
  - 定位点不能死写屏幕正中心：详情浮窗就浮在中间，放大后车会正好被盖住（实测桌面端）。`freeSpot()` 从中心开始试几个候选点，跳过与 `.bus-sheet`/`.ctrl`/`.panel` 矩形相交（带 30px 边距）的位置，再用 `invMercX`/`invMercY` 把“希望车出现的屏幕点”反算成地图中心。改动布局（窗子/面板位置）后要重跑 `scripts/probe-hover-focus.mjs`。
  - 定位后自绘图画一圈 `.bus-pulse` 扩散波（1.6s 后自动清除，`_locTimer` 在 `onUnload` 清掉）；原生地图没有对应能力，靠缩放级别自明。
  - `.tile-layer` 要看一个浅底色：放大到 z18 时单张瓦片 362px，未加载的块会是一大块黑。
- **地图页刷新是可选的自动刷新**：`refreshSec` 取 0（手动）/ 15 / 20 / 30 秒，选择持久化在 uni storage 的 `whbis:map-refresh-sec`；定时器统一由 `restartAutoRefresh()` 创建，生命周期是 **`onShow` 拉起、`onHide` + `onUnload` 停止**（只在 `onLoad` 建会因“进设置页再回来”叠出多个计时器）。
  - 自动触发走 `loadLive(true)`（silent）：**不关 `selectedBus` 详情浮窗、不改 `mapCenter`**，且 `selectedBus` 打开时直接跳过该次 tick。
  - 因为 `mapKey++` 会重建整个 `<map>`，silent 刷新前要用 `@regionchange` 记下的 `_view`（非响应式字段）还原 `mapCenter` / `mapScale`，否则每隔 N 秒画面被拽回首辆车、用户刚拖到的位置丢失。
- `utils/asset.js`：`assetUrl()` 用 `import.meta.env.BASE_URL` 拼子路径前缀，适配 GitHub Pages 子路径部署（`manifest.json` 的 `h5.router.base = /boundless-whbis/`，hash 路由）。地图 marker / `<image>` / CSS 背景等不经构建期改写的静态引用必须走它。

## uni-app H5 渲染坑

- 横向滚动的 `scroll-view`：内容行会被默认 `display:flex` 压到容器宽，导致**内容被裁切而不是滚动**。本项目用 `display: inline-flex + min-width:100%`（见 `line.vue` 的 `.stop-row`）实现 shrink-to-fit，改站点卡片布局时别把这行删掉。
- 右侧车辆面板只有约 280px 宽：刷新控件（`.panel-tools`）必须独占一行，塞回标题行会把「手动 / 20秒」挤成竖排换行；`.refresh-menu` 在窄屏（≤720px，面板落到屏幕底部）必须 `top:auto; bottom:calc(100% + 14rpx)` 向上展开，否则被视口底边裁掉。
- H5 的 rpx 在宽屏（>960px）按 **375 基准**换算（1rpx = 0.5px），不是 `窗口宽/750`；所以桌面上面板只有 ~280px、浮窗 320px，按 rpx 写宽度时别拿桌面窗口宽度反推。
- 样式用 `rpx`，整体**深色主题**，全局背景与导航栏色 `#0b1020`（见 `pages.json`），卡片多为毛玻璃 `glass` 效果 + 靛蓝/青渐变点缀（`#6366f1` / `#06b6d4`）。各页 `<style>` 各自定义，无统一样式文件。⚠️ 青蓝已被征用为「上行」方向色，渐变按钮/选中态可以用，但**不要拿 `#06b6d4` 当普通信息色**（会与上行混淆，下行同理用玫红）。

## 文档可信度

- **以代码为准**：`README.md` 已按本仓库实际更新（目录 `boundless-whbis`、含 `utils/busId.js` / `utils/geo.js` / `utils/asset.js`、`pages/settings`、`deploy/cloudflare-worker.js`、GitHub Pages 部署）。若仍发现出入，以代码为准。
- 中文源文件均为 UTF-8；用 PowerShell `Get-Content` / `Select-String` 输出到控制台会乱码，读文件请用编辑器工具，别把乱码当成文件损坏。
