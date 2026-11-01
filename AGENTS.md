# AGENTS.md — 武汉公交信息实时查询（WuhanBus）

uni-app（Vue 3 + Vite 5）跨端应用：H5 网页版 + Android App，查询武汉公交线路、站点、时刻表、实时车辆。
Git 仓库 main 存源码、pages 分支只存 H5 构建产物（远端 `origin` = `BOUNDLESS-558/boundless-whbis`）。**没有 CI / lint / typecheck**，唯一可执行的验证手段是下面两个 Node 测试和一组 CDP 探针。
提交前注意：`src/config.js` 的 openId 是占位值、`apiProxy`（Cloudflare Worker 地址）均不涉密，可入库；若将来填入真实密钥，先加 `.gitignore` 或改为环境注入。

## 命令（已实测）

```bash
npm run dev:h5       # http://localhost:5173，自带 /api 跨域代理
npm run build:h5     # → dist/build/h5
npm run build:app    # → dist/build/app（之后必须 HBuilderX 云打包，纯 CLI 出不了包）
npm run test:md5     # MD5 单测（RFC 1321 向量 + 实测对照）
npm run test:busid   # 车辆编号还原（全量建字典约 400ms，30s 超时保护）
npm run scan:lines   # 枚举探测线路网，合并写入 src/data/lines.json（数据生成器，会写文件）
npm run scan:hanqi   # 汉奇线路锚点扫描 + /realtime 富化，写进 lines.json 的 hanqi 块（同会写文件）
npm run scan:org     # 从 buspedia.top 采集营运公司填充 lines.json 的 org 字段（会写文件）
npm run deploy:pages # 构建 + 强推 origin/pages（GitHub Pages）
```

- **不要主动构建**：`build:h5` / `build:app` / `deploy:pages` 只在用户明确要求出包/发布时执行，日常改动不跑（用户原话：「没有必要每次都构建一下生成的产物」）。验证仅限 `dev:h5` + 探针/单测在控制台看结论，跑完即止。
- 两个测试是 `node scripts/*.mjs`，失败退出码非 0，可直接当 CI。改完 `md5.js` 或 `busId.js` 必须跑。
- 运行时的 `MODULE_TYPELESS_PACKAGE_JSON` 警告**无害**。别为此给 package.json 加 `"type": "module"`——会破坏 uni-app 工具链。
- `deploy:pages` 走 git 代理，默认 `GIT_HTTP_PROXY=http://127.0.0.1:7890`（置空则直连），细节见 `scripts/deploy-pages.mjs` 头注释。

### 地图回归探针（先 `npm run dev:h5`，端口可能顺延到 5174/5175）

端口不确定时用 `PROBE_BASE` 传真实地址。⚠️ 默认 base 是 `http://localhost:5173/boundless-whbis/`——**必须带子路径**（`manifest.json` 的 `h5.router.base`），写成 `/` 会 404。

**探针不产出任何文件**：不调 `captureScreenshot`、不写日志。视觉核对靠控制台里的量测值（矩形坐标、文案、类名、计算样式、存储值），跑完即完，不落盘。**所有探针脚本的 `shot()` 已统一改为空实现**（调用点保留，临时排查时自行恢复）；仅存的合法写文件例外：`probe-osrm-visual.mjs` 导出 `.openchamber/geom-*.json` 给 `probe-roadfit.mjs` 做几何交接、数据生成器（`scan-lines.mjs` / `scan-hanqi.mjs` / `scan-org.mjs`）落盘线路库数据资产。

**完成功能后自动清理临时生成文件**：`.openchamber/` 里的几何交接文件用完即删；`%TEMP%` 下 `edge-*` 探针 profile 目录（每次运行前会自删重建，但异常中断会残留）定期清掉；任何截图、日志、中间产物都不许留在仓库里。

| 命令 | 作用 |
| --- | --- |
| `probe-osrm-visual.mjs 337 40 [--mobile]` | 清缓存→等吸附→导出走向几何与多张截图。`FOCUS="站A\|站B"` 指定拉近段 |
| `probe-roadfit.mjs .openchamber/geom-337.json 80` | **贴路体检**。判据：中位数 0~2m、P90 ≤5m、unmatched 0 点 |
| `probe-nearest.mjs 337 0` | 坏段诊断：每端点最近 3 条路 + 两两规划，识别「吸到高架/对向车道」 |
| `probe-label-overlap.mjs "<url>" 30 [--mobile]` | 站名/车号/圆点两两重叠，四类全空才算过 |
| `probe-line-colors.mjs 337` | 详情页方向配色，读回 `.seg`/圆点/页签的计算样式 |
| `probe-hover-focus.mjs` | 悬停浮标 + 「在地图上定位」落点；**改布局后必跑** |
| `probe-ctrl-row.mjs 337` | 左上控制卡版式：整卡包裹 / 四块左缘对齐 / 不溢出 / 方向行单行 / tab 文字居中 / 徽标紧邻线路号，跑 1440·390·360·320 四个视口。**改 `.ctrl` 内任何版式后必跑** |
| `probe-refresh.mjs 337 [PROBE_VIEW=stops]` | 刷新控件体检：地图页（默认）或实时线路视图（`PROBE_VIEW=stops`）的 ↻+间隔下拉胶囊，含结构/四项/选中态/菜单不溢出/存储与真实请求节奏。`PROBE_MOBILE=1 PROBE_QUICK=1` 只验窄屏渲染 |
| `probe-osrm-legs.mjs 337 0` | 逐段垂距明细，调 OSRM 阈值时用 |
| `probe-line-suggest.mjs` | 首页线路号联想：面板定位/排序/命中总数/白名单（J1、G73 必须“未收录”）/点选后关面板出结果。**改 `lineIndex.js` 或 `index.vue` 搜索区后必跑** |

## 线路库与线路号联想

后端只有「按 lineCode 查单条」的 `/line`，**没有线路列表接口**，所以线路库靠枚举探测生成：

- `scripts/scan-lines.mjs` → `src/data/lines.json`（当前 1137 条：数字 529 / D 546 / K 56 / 电 5 / BRT 1）。它是**允许主动写文件的生成器之一**（产物就是数据资产）。`utils/lineIndex.js` 直接 `import` 该 JSON，构建期进 bundle，联想时 0 请求。
- **汉奇公交持久化在同一份 lines.json 的 `hanqi` 块**（`npm run scan:hanqi` → `scripts/scan-hanqi.mjs`：7 锚点 `/nearby` 去重 + 逐条 `/realtime` 富化起讫站/站数）。`lineIndex.js` 导出 `HQ_LINES/HQ_UPDATED`，`LineDb.vue` 汉奇页签**直读本地数据（切页签 0 请求）**，↻ 才是手动重扫；两个生成器各管各的块，`scan-lines.mjs` 重写时会原样带走 `hanqi` 块，别改成整文件覆盖。汉奇线展示名用 `lineName`（routeName，如「汉奇K6」），查询键是 17 位数字 `lineId`（`lineCode` 编码为 `hanqi-{lineId}`），**严禁把数字 ID 当线路号显示**（曾有 BUG，见 `applyHostLine()`/`probe-hanqi-name.mjs`）。接口协议见文档第七章。
- **判据是「`lineName` 有值」**，不是「站点非空」：2/3/5/11/19 路都是 `20000` + 有 `lineName` + `stopDetailList` 为空，按站点判会漏 14 条。反向复核顺便用另一方向补站数/起讫站（反向起点 = 正向终点）。
- **`lineCode` ≠ 线路号**：后端 lineCode 是内部编码，`1001` 实际是「电1」、`2001` 是「J1」、`81` 是「H81」。JSON 里 `no` = 按 `lineName` 归一后的真实线路号（展示/联想用），`code` = lineCode（查询用）。别把两者混用，否则 J/H 线会以数字编号混进库里。
- **前缀白名单只有 `电 / BRT / K / D`**（用户确认）：`--prefix` 传其它字母会直接报错退出，别再扫 26 个字母；落盘前还会剔除名字带 H/J 前缀及「测试/内部线路」的条目。
- 分批扫描一律带 `--merge`（只补强不降级：`dirs` 取并集，站数/起讫站/首末班仅在空值时回填，`status:'停运'` 人工标记不会被后端缓存数据覆盖）。**改完后处理逻辑不想联网**时用 `node scripts/scan-lines.mjs --normalize-only --merge`。
- 已知数据缺口：73 条无站数、10 条无起讫站（后端两个方向都空），UI 显示「站数未知 / 起点未知」兜底，不是 bug。
- **`org` 字段（营运公司）**：由 `scripts/scan-org.mjs` 从 buspedia.top（巴士派迪）采集写入 lines.json（全名如「武汉市公共交通集团有限责任公司第五营运公司」）。一次性拉取 `https://buspedia.top/comp/zek3io/lines` 的 Nuxt SSR 内嵌数据，解析线路→公司映射后按 `no` 匹配写回。覆盖 562/1137 条（含 85 条 D 线，旧 8684 源不收录 D），剩余 575 条主要是 buspedia 也未收录的小众 D/K 线。**汉奇块（`hanqi.lines`）也会被补 org**（按 `lineName` 整名匹配 buspedia，当前仅景景有约巴士系命中）：汉奇车辆的 busId 是车型码、首位不代表公司，线路级徽标只能靠这个静态归属（详见「方向配色」后的营运公司约定）。只补强不降级（已有 org 默认跳过，`--force` 才覆盖）；支持 `--dry`。站点偶尔响应慢，脚本内置 3 次重试 + 180s 超时。`scan-hanqi.mjs` 重扫时按 lineId 携带旧 org（无论是否 `--merge`），不会冲掉采集到的归属。
- **`orgOf(line)`**（`lineIndex.js` 导出）：把 org 全名归类为 `{ key:'第X公司', label:'X公司', full }` 或 `{ key:'其他', … }`；空值返回 null。`LineDb.vue` 的公司筛选行依赖它——动态生成档位（数据中存在的公司才出现），未入库线路归「未收录」。筛选行只在 `orgOpts.length > 1` 时渲染，数据全空时整行隐藏不是 bug。
- **地图/首页联想同时覆盖汉奇线**：`lineIndex.js` 里 `suggestLines`/`countMatches` 走 `SEARCH_INDEX = INDEX.concat(HQ_INDEX)`（汉奇项带 `source:'hanqi'` + `lineId`），而 **`allLines()` 仍只回武汉公交**（`LineDb` 武汉页签、`LineMap` 全市线网 lib 都靠它，别把汉奇混进去污染）。`LineSearch` 点选/查询命中汉奇时上抛 `{ source:'hanqi', lineId, lineName }`（与 `LineDb.openHanqi` 同口径），宿主 `applyPick` 据此切 `lineSource='hanqi'`。汉奇 `HQ_INDEX.alt` 故意留空——起讫站常含「地铁」，拿来匹配会让「电」这类关键词误命中、打乱联想排序（`probe-line-suggest.mjs` 的「电=5 条」断言依赖这一点）。

## 接口协议（三条铁律）

后端 `https://customized.wuhanbus.com/gps-resapi/wechat/bus`，完整文档见仓库根目录 **`武汉公交实时API接口文档.md`**（注意文件名不含「信息查询」）。

1. 必须 `POST + application/json`，GET 不支持。
2. **`openId` 必须放请求头**；放 query/body 返回 `90001`。**值不校验**——`config.js` 里任意非空字符串即可，不要去找「真实 openId」。
3. `/line` 传 `lineCode`，`/detailPlanTime`、`/detailData` 传 `lineId`（用错报 `3014`）。格式同为 `{cityCode}-{线路号}-{方向0|1}`，由 `buildLineCode()` 生成。

响应判据 `payload.success === true && payload.msg.code === '20000'`（`api.js` 的 `post()`）。
后端怪癖：响应 `direction` 与请求方向**相反**，一律以请求编码 / `stopDetailList` 顺序为准。

## 架构要点

- **四个页面**：`index`（搜索 + 上下行结果 + BYOK 面板）→ `line`（详情）→ `map`（地图），另有 `settings`（BYOK 独立页，逻辑与 index 面板重复）。页面靠 **URL query 传参**（lineCode/direction/lineName/startStop/endStop），改跳转要同步改对端 `onLoad`。
- **请求 base 三段切换**（`api.js`）：H5 dev → `/api` 代理；H5 prod → `APP_CONFIG.apiProxy`（Cloudflare Worker 反代，`deploy/cloudflare-worker.js`，因为上游 `OPTIONS` 无 CORS 头）；App → 直连。
- **`busId.js`**：`busId = MD5(自编号)`，枚举 0~200000 建反查字典。分片异步（每片 8000 + `setTimeout`）防卡 UI；**就绪前 `decryptBusId()` 返回 null**，页面必须用 `onBusIdReady(cb)` 二次刷新。终止条件必须 `end >= DICT_MAX`，写成 `n <= DICT_MAX` 会在 `n == DICT_MAX` 死循环。
- **`geo.js`**：Haversine + 车辆匹配最近站点。⚠️ 接口坐标**已是 GCJ-02**，直接上高德；`wgs84ToGcj02()` 只用于确实持有 WGS-84 的场景，误用会整体偏数百米。
- **`asset.js`**：`assetUrl()` 用 `import.meta.env.BASE_URL` 拼前缀，适配 `manifest.json` 的 `h5.router.base = /boundless-whbis/`（hash 路由）。marker icon / `<image>` / CSS 背景等不经构建期改写的引用必须走它。
- **本地账号（`auth.js`）**：预置账号制，默认口令 = `genPass(账号)`（确定性 md5 派生，不落地）。用户可在「账号与设置 → 登录密码」改成自己的密码：只把 `hashPass(账号,新密码)` 写进本机 `whbis:pass-override`（按 `normAccount` 小写主键），**仍不存明文**；未改过的账号不进表。**登录/校验一律走 `verifyPass()`**（有覆盖比哈希、无覆盖比 `genPass`），别再在别处直接比 `genPass`。改密/恢复默认都要求先验当前密码（`changePassword`/`resetPassword`），防会话被人顺手改掉。这是「使用门槛」非安全机制。

### 地图双模式（判据是 `useNativeMap()`，不是 `hasMapKey()`）

有两套**视觉完全不同**的渲染：「自绘走向图」（青蓝/玫红分色双轨 + 白心站点 + 白底站名贴片）和「原生 `<map>`」（高德底图 + 原生 marker/polyline）。判据简化后只剩一个真值（`config.js` 的 `useNativeMap()`）：

- **App 端**：Key 随安装包内置（`manifest.json` 的 `sdkConfigs.maps.amap.key`），`APP_CONFIG.mapKey` 非空 → 原生地图；
- **H5 端**：`APP_CONFIG.mapKey` 留空（现状）→ `useNativeMap()` 恒为假 → 一律走自绘走向图（免 Key 的 OSRM 贴路 + 高德免 Key 瓦片）。
- BYOK（用户自填 Key）入口已整体移除：`config.js` 不再读 `amap_byok_config` 存储，`main.js` 不再调 `applyAmapConfig()`，也没有设置抽屉/齿轮。若将来需要 H5 端用原生地图，只需在 `manifest.json` 的 H5 `sdkConfigs.maps.amap` 填入 Web端(JS API) Key 与 `securityJsCode`（构建期注入，改完需重启 dev 服务器）。

⚠ 不要重新引入「三档渲染开关」（旧的 `map_render_mode` auto/schematic/native 已删）：判据必须是单一 `useNativeMap()`，页面里别自己拼 `hasMapKey()` / `APP_CONFIG.mapKey` 的变体，否则会出现"设置页显示原生、地图页却画自绘"的分裂。

走向图模式的两个底座：

- **底图**：`.tile-layer` 用 `<image>` 拼高德标准瓦片（`webrd0{1-4}.is.autonavi.com/appmaptile?...style=8`，免 Key、GCJ-02、256px），`zt=floor(zoom)` + `scale=2^(zoom-zt)` 定位，再叠 `.tile-shade` 暗蒙版。`.tile-layer` 需要浅底色，否则 z18 下未加载瓦片是一大块黑。
- **走向**：`utils/osrm.js` 调 OSRM（WGS-84，需与 GCJ-02 互转）吸附站点序列。
  - 逐段质检用**最大垂距**，不要用「规划距离/直线距离」ratio——站前掉头 ratio 11 只偏 76m 却真实，吸到高架 ratio 17 已跑 3km 外。
  - 四级修复：贴走廊 → 加 1/3、2/3 途经点 → **换端点吸附候选**（`/nearest?number=3`）→ 站间直线。第三级是实测关键：坏段根因是站点被吸到高架层/对向车道；吸附点离站 >60m 不认，且要用 `distance >= straight*0.8` 剔除「跳过」而非「绕开」。
  - 缓存 7 天，键 `whbis:osrm-route:v5:`。**升版本号后旧键不会自动清理**，探针需先清 localStorage。公共 demo 服务会限速断连，全失败只回退站点连线。
  - 已实测**无效、不要重试**：`exclude=motorway`、`alternatives=3`、foot/walking profile、FOSSGIS 服务；以及「免 Key 拿高德官方轨迹」三条路（iframe 嵌入 / 直拉 amap.com 接口 / OSM relation，详见代码注释）。对应的临时探针（`probe-embed-and-exclude.mjs`、`probe-amap-*.mjs` 等）已随路线否决删除。
- 走向未贴路时画的是站间直连（细虚线 + `routeAlert` 提示）。**判断截图前先确认吸附完成**（缓存已落库、无 alert），别把初屏当结果。

### 方向配色（全站唯一真源）

`map.vue` 的 `DIR_STYLE`：**上行青蓝 `#06B6D4`/`#22D3EE`，下行玫红 `#F43F5E`/`#FB7185`**。`line.vue` 用 `.dir-up`/`.dir-down` 的 CSS 变量镜像，**改色必须两处同改**。选青/玫红而非红/绿是为色盲友好。
- 上下行同屏**必须分轨**，否则后画的整条盖掉先画的：SVG 投影后各偏 3.5px，原生地图 `offsetPolyline()` 各偏 14m。
- 原生折线层序：先铺两个方向的白色外描边（width 9），再画方向色主线（width 5）。**下行不加虚线**——玫红虚线压在同一条走廊上会和青蓝主线互相打架，方向靠 14m 分轨偏移 + 色相已足够区分。
- 原生视野必须由 `fitNativeView()` 自适应：`fitRoute()` 只算自绘相机的 `cam`，不写 `mapScale`/`mapCenter` 的话原生 `<map>` 会永远停在初始 `scale: 13`，跨区线路被压成屏幕中间一小团（这是「走向图不好看」的头号原因）。scale 用线路包围盒按 `fitRect()` 可绘制区反算，并同步 `_view` 防止 silent 刷新把视野拽回。
- 站点图标按方向/首末站分四张（`stop-dot-{0,1}.png` 11→13px 白心圆环、`stop-end-{0,1}.png` 19px 实心大圆），由 `scripts/make-stop-dot.ps1` 生成；车辆图标同理由 `scripts/make-bus-icons.ps1` 生成 `bus-live-{0,1}.png`（方向色实心圆 + 白描边）。站名用 `label`：白底贴片 + 方向色压暗文字（`labelText`），并显式把 `borderColor` 置透明，否则 uni-h5 会按方向色描一圈边。
- 车辆圆点同色系提亮一档（`#67E8F9`/`#FDA4AF`）+ 白描边，否则在同色线上糊成一团；`.ttag` 地铁标签用紫色是为了不撞上行青蓝。

### 地图页的 uni-h5 陷阱（踩过且无人报错）

- **`markertap` 参数在 `e.detail` 里**。uni-h5 的 `normalizeCustomEvent()` 只给 `{type,timeStamp,target,currentTarget,detail}`，**没有**扁平 `markerId`；写 `e.markerId` 恒为 undefined，表现为「点车辆图标毫无反应」。`regionchange` 等同理，一律从 `e.detail` 取。
- **marker 绝不能传 `title`**。uni-h5 用 `title` 建隐藏 callout，而 click 监听会 `callout.visible = !visible` → 每点一次车图标冒出白框盖住底图。站名用 `label`。同理**不挂 `callout`**，车辆信息只在用户主动点击后的浮窗展示。
- 折线 `color` 只吃十六进制（`hexToRgba` 不认 `rgba()`），callout `bgColor` 反过来只认 `rgba()`。**H5 端 `arrowLine` 是空属性**（只有 App/小程序生效），别指望地图上有方向箭头。

### 地图页交互

- **车辆详情是可拖动浮窗**（`.bus-sheet`），不是底部弹层：无遮罩、标题栏拖动、`📌` 固定、`✕` 关闭。`sheetPos` 是 px 绝对坐标，每次移动过 `clampSheet()` 夹在视口内，`window.resize` 也要重夹。触摸走模板 `@touch*`；**鼠标必须原生监听**（`.sheet-head` 挂 mousedown，移动/抬起挂到 `document`），收尾在 `onUnload`。拖动结束 120ms 内用 `_suppressSheetClick` 屏蔽按钮误触。
- **悬停显示自编号**：marker 没有可用的 hover 事件，自己做命中判定——`mousemove` 挂容器，`_projectTo()` 把经纬度按 Web Mercator 投到像素，<18px 命中。原生用 `_view`、自绘用 `cam/projCenter`，两边都要实现。
- **`focusBus()` 是真定位**：原生要**同时**写 `mapCenter`/`mapScale`/`_view`，否则下一轮 silent 刷新拽回去。定位点不能死写屏幕中心（浮窗正好盖住），`freeSpot()` 跳过与 `.bus-sheet`/`.ctrl`/`.panel` 相交的位置，再用 `invMercX/invMercY` 反算中心。
- **自动刷新可选**（0/15/20/30 秒，持久化 `whbis:map-refresh-sec`）。定时器统一由 `restartAutoRefresh()` 建，**`onShow` 拉起、`onHide`+`onUnload` 停止**——只在 `onLoad` 建会因「进设置页再回来」叠出多个。silent 刷新（`loadLive(true)`）不关浮窗、不改中心，且浮窗打开时跳过该 tick。
- 刷新会 `mapKey++` 重建 `<map>`（清 callout 残留），所以重建前要用 `_view` 还原视野。
- **左上控制卡是“整卡包裹”**：`.ctrl` 本身就是那张玻璃卡片（`padding: 12rpx` + `border-radius: 26rpx` + 背景/描边/阴影），内部依次是 搜索行 → `.ctrl-div` → 主操作行（只剩「一键查询」并独占整行）→ `.ctrl-div` → 方向行（全部/上行/下行 + 循环切换键 `⇄` + 线路号 + 营运公司徽标）→ `.ctrl-div` → 视图工具行（缩放 / 全览 / 站名 / 底图）。视图工具栏在**最底部、方向行下方**；卡片内不放操作说明文字（原来那段“青蓝上行 / 玫红下行…”已按用户要求删除，不要再加回去）。**子块不要再自带背景、描边、阴影**，否则又退回“一堆漂浮胶囊”的碎片感。卡片默认宽 860rpx（可拖右下角缩放，见「面板自由缩放」），`fitRect()` 读 `.ctrl` 实测 bottom 让绘制区避开它，所以加高/加宽卡片都是安全的（缩放后必须 `measureUi()` 重排）。
- `.ctrl-dir` 是**单行**（`nowrap`）：全部/上行/下行/`⇄`/线路号/公司徽标必须同排，别改回 `wrap`；线路号用 `margin-left: auto` 靠右，公司徽标紧跟其后（`.ctrl-org` 可压缩、公司名出省略号）。`.dir-tab` 用 `height + inline-flex` 双轴居中，只靠 padding 会因中文基线和加粗跳字。“切换方向”（`cycleDirView`）必须是 `.dir-swap` 小方键、**紧贴三个 tab 右侧**（用户明确表示挂在一键查询旁边难看），着色类 `'d' + dirFilter`（d0 青 / d1 玫红 / d2 中性）。
- 站名标签：窄屏（canvas < 600px）按 `stride` 抽稀到约 10 个并把 zoom 门槛放到 10.5，否则 390px 里全碰撞只剩首末站；首末站恒显示，碰撞时上下微移。

### 面板自由缩放（`utils/panelResize.js`，仅 H5/桌面）

所有浮层面板都可拖拽改宽/高并持久化记忆，双击手柄复位。实现是一个**纯 DOM 辅助** `createResizable(el, opts)`（不依赖 Vue 响应式）：挂一个 `.rs-grip` 手柄（`edge: right|left|bottom|corner`），Pointer Events 拖动实时写 `el.style`，松手落库。接线点：

- **控制卡 `.ctrl`**（`key:'ctrl'`, **右边手柄只改宽、高度固定**）、**右侧栏 `.side-col`**（`key:'side'`, 左边手柄只改宽，右锚定向左变长）、**车辆卡 `.panel`** / **时刻表卡 `.plan-side`**（`key:'panel'/'plan'`, 底边手柄写 `max-height`）在 `LineMap.setupPanelResize()` 里挂；`FloatWin` 靠 `resize-key` prop（stops/db/account）在自身 `mounted` 挂，**默认 `resize-axis='x'`（右边手柄只改宽、高度由内容+maxHeight 定，三窗均此）**，传 `'both'` 才改回右下角同时改宽+高（`_syncResize` 对 `'x'` 不写 `rsH`）。
- **`.ctrl`/`.side-col` 缩放后必须回调 `measureUi()`**，否则 `fitRect()` 不会避让新尺寸。`setupPanelResize()` 用 `el.__rs` 标记幂等，并在 `measureUi` 末尾补挂（覆盖 `v-if` 重建出的新面板），销毁函数收进 `this._resizers`，`cleanup()` 里逐个 `destroy`。
- **键统一 `whbis:panel-size:v1:<key>`**，存 `{w,h}`（px，只存适用轴）；`FloatWin` 的记忆值经 `rsW/rsH` data 回流到 `winStyle`，否则位置拖动重渲染会用 `widthPx` 把宽度刷回去。
- **手柄用 JS 内联样式绘制，不走 scoped CSS**：`document.createElement` 出来的节点拿不到 Vue 编译期的 `data-v-*`，scoped 选择器匹配不到。
- **仅 H5**：App 端无 `document`，`createResizable` 直接返回 noop，面板保持固定尺寸；窄屏（`matchMedia('(max-width:720px)')`）不接管，沿用各面板自带的响应式塌缩。
- 默认宽：`.ctrl 860rpx / .side-col 720rpx`（`.plan-side` 需 `position:relative` 才兜得住它的底边手柄）。

## 写探针的坑（`scripts/probe-*.mjs`）

CDP 驱动 Edge headless 做真实浏览器实测，`node scripts/probe-xxx.mjs` 直跑，**先 `npm run dev:h5`**。

- **一律不写文件**（截图、日志都算）：vite 的 file watcher 会 watch 整个项目，探针正在写的 `.log` 会抛 `EBUSY: resource busy or locked` 并**直接杀掉 dev server**（表现为“刚还 200、下一秒无法连接”），`.openchamber` 也可能被外部进程清掉。要断言就 `Runtime.evaluate` 取量测值打控制台；`vite.config.js` 里的 `server.watch.ignored` 仅作兜底。
- **页面 readiness 用轮询**，别固定 `sleep`：vite 按需编译，首次进某页明显变慢。写 `waitFor(expr)` 直到 `!!window.uni && !!document.querySelector('.cfg-fab')` 之类成立。
- **同一 hash 路由内 `Page.navigate` 不会重建页面**，`useMap`/`onLoad` 都不会重跑。要换存储/换模式验一遍，必须 `about:blank` → 目标页（彻底换文档），或在页面里 `location.reload()`。
- 页面实例沿 `__vueParentComponent` 往上找；但 **Vue reactive proxy 不能 by value 序列化**（直接 return 得到 `{}`），要逐字段取 `p.cam.zoom`、`p.canvas.w`。
- 假高德 Key 走原生模式时 SDK 会报 `INVALID_USER_KEY`，页面可能整个起不来 → 此类场景记“不可判定”，别当成失败。
- **uni H5 存储值是被包过的**：`localStorage` 里是 `{"type":"number","data":15}`，断言要取 `.data`；反面是 `getStorageSync` 在键不存在时返回**空字符串**，`Number('') === 0` 会让「从没设过」被误判成 0——而 0 本身是合法值（手动），所以业务代码里必须先排除空值再比白名单。

## uni-app H5 渲染坑

- 横向滚动容器内的内容行会被默认 `display:flex` 压到容器宽，**内容被裁切而非滚动**。`line.vue` 的滚动容器是 `.route-strip`，内层内容行 `.strip-inner` 用 `display: inline-flex + min-width:100%` 做 shrink-to-fit，改线路带布局别删这两行。
- H5 的 rpx 在宽屏（>960px）按 **375 基准**换算（1rpx = 0.5px），不是 `窗口宽/750`。桌面上面板只有 ~280px，别拿桌面窗口宽度反推 rpx。
- 右侧车辆面板约 280px：`.panel-tools` 必须独占一行；`.refresh-menu` 在 ≤720px 下须 `top:auto; bottom:calc(100% + 14rpx)` 向上展开，否则被视口底边裁掉。详情页的同一控件贴行尾，下拉改 `right:0` 向左展开（`left:0` 会顶出页面右边界）。
- 深色主题，全局背景/导航 `#0b1020`（`pages.json`），卡片毛玻璃 `glass` + 靛蓝/青渐变。各页 `<style>` 各自定义，无统一样式文件。⚠️ `#06b6d4` 已被征用为上行色，别当普通信息色用。

## 其他约定

- 详情页刷新控件与地图页同款（`↻ | 间隔 ▾` 双层胶囊 + 下拉 0/15/20/30 秒）：**默认 15 秒**（旧行为），持久化在 `whbis:line-refresh-sec`，与地图页的 `whbis:map-refresh-sec` **各自独立**（两页使用节奏不同）。定时器统一由 `restartAutoRefresh()` 重建，`onShow` 拉起、`onHide` + `onUnload` 停止；切到自动模式时立刻补拉一次。新增异步任务/定时器同样要在 `onUnload` 收尾（地图页还有 `_autoTimer`/`_locTimer`/手势监听）。
- 营运公司徽标：武汉公交给**由在线车辆自编号（orgId，纯数字）首位推断**（1 → 第一营运公司），`index` 优先用时刻表 `orgBusId` 明文，缺失才回退实时车辆（需 MD5 还原）。**汉奇线不同一口径（旧结论已推翻）**：汉奇 `busId` 是车型编号（如 `460C32D0`），首位不代表公司（景景有约实为二公司线路，按首位会被误判成四公司）；所以汉奇的 `operatorCompanies` / `busCompanyText` / 复制的 `companyOf` **一律走线路库静态归属**（`lineIndex.js` 的 `hanqiRouteOrg(lineId)`，由 `scan-org.mjs` 自 buspedia 采集写入 `lines.json` 的 `hanqi.lines[].org`）；未收录的汉奇线宁可不显示徽标（返回空 / 「营运公司未知」），也不能拿车型码首位猜一个错的公司。但 `.dir-cur` 必须 `flex: 0 1 auto + min-width: 0`（`.dc-no` 配 `overflow:hidden; text-overflow:ellipsis`）：汉奇中文全名长，徽标回到方后若胶囊不可收缩会把徽标顶出定宽控制卡、造成错位。
- 方向徽标文字写全「上行 / 下行」，不要缩成「上 / 下」。
- **汉奇线不开「实时线路」视图**（LineStops 浮窗）：`map.vue` 的 `switchView('stops')` 与 `onLoad` 的 `q.view==='stops'` 都要在 `lineSource === 'hanqi'` 时拦回落回地图（toast「汉奇线路暂不支持实时线路视图」）。LineStops 整套拉数 / 徽标 / 复制都按武汉公交 `420100-lineCode` 协议与自编号首位口径，汉奇线进来既拉不到站点，又会把车型码首位当公司号误挂——别为了「视图统一」放开这个口子。
- 中文源文件均为 UTF-8；PowerShell `Get-Content`/`Select-String` 输出到控制台会乱码，读文件用编辑器工具，别把乱码当文件损坏。
- `README.md` 已与实际同步；若仍有出入，**以代码为准**。
