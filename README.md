# 武汉公交信息实时查询（WuhanBus App）

基于 **uni-app（Vue 3 + Vite）** 的武汉公交信息实时查询在线营运线路信息查询应用。

**目标平台**：Android App + Web（PC/移动浏览器）
**技术栈**：uni-app 3.x / Vue 3 / Vite 5
**项目位置**：`D:\Development\Workspaces\boundless-whbis`（Git 仓库根目录，main 分支）
**远端仓库**：`https://github.com/BOUNDLESS-558/boundless-whbis.git`（origin）
**接口文档**：`武汉公交信息实时查询API接口文档.md`（仓库根目录，UTF-8）

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
   - **第三方 SDK**：`app-plus.distribute.sdkConfigs.maps.amap.key` 填写 Android 平台的高德 Key（不填则地图页降级为「线路示意图」模式）
4. 菜单 → 发行 → **原生 App - 云打包** → 选择 Android → 打包

> 云打包需要 DCloud 账号登录。打包完成后下载安装包即可真机安装。

### 方式 C：运行单元测试

```bash
npm run test:md5      # MD5 实现单测（RFC 1321 向量 + 实测对照）
npm run test:busid    # 车辆编号还原测试（全量建字典约 400ms）
```

两个测试都是 `node scripts/*.mjs`，失败时退出码非 0，可直接当 CI 用。

### 常用命令速查

| 命令 | 作用 | 产物位置 |
| ---- | ---- | -------- |
| `npm run dev:h5` | 启动网页版开发服务器 | 内存（热更新） |
| `npm run build:h5` | 构建网页版 | `dist/build/h5` |
| `npm run build:app` | 构建 Android App 资源 | `dist/build/app` |
| `npm run deploy:pages` | 构建 H5 并推送到远端 `pages` 分支（GitHub Pages） | — |
| `npm run test:md5` | MD5 单元测试 | — |
| `npm run test:busid` | 车辆编号还原测试 | — |

---

## 二、目录结构

```
boundless-whbis/
├── index.html                 # H5 入口模板
├── vite.config.js             # Vite 配置（含 H5 开发跨域代理 /api）
├── scripts/
│   ├── test-md5.mjs           # MD5 单元测试（RFC 1321 向量 + 实测数据）
│   ├── test-busid.mjs         # 车辆编号还原测试（终止性 + 正确性 + 性能）
│   ├── deploy-pages.mjs       # GitHub Pages 一键部署（孤立提交强推 pages 分支）
│   ├── make-stop-dot.ps1      # 生成站点圆点静态图（PowerShell 脚本）
│   ├── openid_sniffer.py      # mitmproxy 插件：抓取 openId（备用方案）
│   └── probe-*.mjs            # CDP 探针（地图走向/贴路/配色/重叠体检，需先跑 dev:h5）
├── .opencode/
│   └── commands/init.md       # /init 命令：刷新本目录文档并清理临时文件
├── deploy/
│   └── cloudflare-worker.js   # ★ Cloudflare Worker 反向代理（解决 H5 生产 CORS 预检）
├── README.md
└── src/
    ├── main.js                # 应用入口
    ├── App.vue                # 全局生命周期
    ├── config.js              # ★ 应用配置（openId / cityCode / apiProxy / 地图 BYOK）
    ├── manifest.json          # App 打包配置（Android 权限 / 地图 SDK / H5 路由基准）
    ├── pages.json             # 路由与全局样式配置
    ├── uni.scss               # 全局 SCSS 变量
    ├── pages/
    │   ├── index/index.vue    # 首页：线路搜索 + 上下行结果卡片 + 地图设置入口
    │   ├── line/line.vue      # 线路详情：站点 / 时刻表 / 实时车辆（Tab，最复杂）
    │   ├── map/map.vue        # 实时车辆地图（原生地图 / 线路示意图双模式）
    │   └── settings/settings.vue # 地图服务设置（BYOK：用户自填高德 Key）
    ├── utils/
    │   ├── api.js             # ★ 接口请求层（封装 3 个公交接口 + 车辆还原再导出）
    │   ├── busId.js           # ★ 车辆编号逆向还原（分片异步构建字典，防卡 UI）
    │   ├── md5.js             # 纯 JS MD5 实现（RFC 1321，零依赖）
    │   ├── geo.js             # ★ Haversine 距离 + 车辆匹配最近站点 + GCJ-02 ⇄ WGS-84
    │   ├── osrm.js            # ★ 站点序列吸附 OSM 道路（OSRM，免 Key，7 天缓存）
    │   └── asset.js           # ★ 基址感知的静态资源路径解析（子路径部署）
    └── static/
        ├── logo.png
        ├── bus-live.png
        ├── stop-dot.png       # 线路示意图用的站点圆点
        └── background.jpg
```

---

## 三、接口协议（★ 已破解，务必照做）

完整说明见仓库根目录 `武汉公交信息实时查询API接口文档.md`。

### 三条铁律

1. **必须 POST** + `Content-Type: application/json`（GET 不支持）
2. **openId 必须放在请求头**（header），放 query / body 一律返回 `90001 缺少openId`
3. **openId 的值服务端不校验**，任意非空 ASCII 字符串即可（`config.js` 里已填占位值，无需去找真实 openId）

### 请求样例

```http
POST https://customized.wuhanbus.com/gps-resapi/wechat/bus/line HTTP/1.1
Content-Type: application/json
openId: wx_openid_dev_001

{
  "cityCode": "420100",
  "lineCode": "420100-337-0",
  "xiaomaAppId": "wxaa1d01cdc96a2c0c",
  "appKey": "A0CADFE6F3B914A2",
  "appType": 4,
  "codeType": 1,
  "channelId": 23000003,
  "appSource": 2
}
```

### 三个接口的参数差异（易错点）

| 接口 | 线路参数 | 用途 |
| ---- | -------- | ---- |
| `POST /bus/line` | `lineCode` | 线路基础信息 + 全部站点（含经纬度、地铁换乘） |
| `POST /bus/detailPlanTime` | `lineId` | 计划发车时刻表 |
| `POST /bus/detailData` | `lineId` | 在线运营车辆实时 GPS |

> ⚠️ 用错参数名会返回 `code:3014 lineCode:线路ID不能为空` / `lineId:线路id不能为空`。

### 线路编码规则

`{cityCode}-{线路号}-{方向}`，方向 `0` / `1` 表示上下行，例：`420100-337-0`。由 `config.js` 的 `buildLineCode()` 生成。
> 后端怪癖：响应里的 `direction` 字段与请求后缀**相反**，但 `stopDetailList` 的顺序与请求方向一致，以站点列表为准。

---

## 四、地图（双模式 + BYOK）

地图页支持**双模式**，无 Key 也能跑通：

| 模式 | 触发条件 | 说明 |
| ---- | -------- | ---- |
| 原生地图 | `hasMapKey()` 返回 true | 使用 uni-app `<map>` 组件（高德底图 + 折线走向） |
| 自绘走向图 | 无可用 Key（默认） | 自绘 SVG：高德瓦片底图 + 贴路走向 + 站点 + 实时车辆 |

**自绘模式的两个底座**（都不依赖高德 JS API）：

- **底图**：用 `<image>` 拼高德标准瓦片（`webrd0{1-4}.is.autonavi.com/appmaptile?...style=8`，免 Key、GCJ-02、256px），按相机浮点 zoom 取 `floor(zoom)` 的瓦片层 + 缩放定位，再叠加暗色蒙版降饱和，保证站名/车号可读。控制卡可关闭底图。
- **走向**：`utils/osrm.js` 调 OSRM（`router.project-osrm.org`，WGS-84）把站点序列吸附到 OSM 道路，坐标需 GCJ-02 ⇄ WGS-84 互转（`geo.js` 的 `gcj02ToWgs84`）。
  - 逐段质检用**最大垂距**，不用「规划距离/直线距离」的 ratio——站前掉头 ratio 能到 11 但实际只偏 76m，而吸附到高架 ratio 17 时已跑到 3km 外。
  - 坏段修复四级：贴走廊直接用 → 加途经点重算 → **换端点吸附候选重算**（`/nearest?number=3`）→ 站间短直线。坏段根因是站点被吸到高架层/对向车道。
  - 结果按 `{线路号}-{方向}` 缓存 7 天（键前缀 `whbis:osrm-route:v5:`，算法变更需升版本号）。OSRM 是公共 demo 服务，会限速/断连，全部失败仅回退站点连线，不影响主流程。
  - 走向未贴路时（初屏几秒 / OSRM 失败）画的是站间直连虚线，并显示「贴路计算中 / 贴路服务不可用」提示。

**方向配色（全站统一，两页必须一致）**：**上行 = 青蓝（`#06B6D4` / `#22D3EE`），下行 = 玫红（`#F43F5E` / `#FB7185`）**。`map.vue` 的 `DIR_STYLE` 是唯一真源，`line.vue` 用 CSS 变量镜像。青/玫红而非红/绿，是为了色盲友好。上下行同屏时按行进法向分轨偏移（自绘 3.5px，原生地图 14m），否则后画的会整条盖掉先画的。

**Key 获取方式（BYOK，自带密钥方案）**：

项目出于安全**不再内置高德 Key**。用户需自行申请，且 H5 与 App 端 Key 类型不同：

- **H5**：到[高德开放平台](https://console.amap.com/dev/key/app)申请「Web端(JS API)」类型的 Key + 安全密钥。
  - 首页右上角 ⚙ 齿轮 →「地图服务设置」展开面板，或进入 `pages/settings/settings.vue` 填入。
  - 保存后存 `localStorage`（`amap_byok_config`），运行时由 `applyAmapConfig()` 覆写 `__uniConfig.aMapKey`。
  - ⚠️ 高德 SDK 一经加载无法换 Key，保存后需**整页重载**才生效。
- **App 端**：申请「Android/iOS 平台」类型的 Key，填入 `src/manifest.json` 的 `app-plus.distribute.sdkConfigs.maps.amap.key`，随安装包内置，无需用户配置。

`src/config.js` 的 `mapKey` 字段默认留空；`hasMapKey()` 综合判断内置 Key 与用户自定义 Key 是否可用。

> ⚠️ 实测：武汉公交 API 返回的站点/车辆坐标**已是 GCJ-02**（与高德官方线路轨迹偏差仅约 18m），直接上高德地图即可，切勿二次转换（`geo.js` 的 `wgs84ToGcj02` 仅供持有 WGS84 原始坐标的参考场景）。

---

## 五、MD5 车辆编号还原（`src/utils/busId.js` + `src/utils/md5.js`）

接口返回的车辆编号为标准 MD5 摘要：

```
busId = MD5( orgBusId )
```

| 模块 | 职责 |
| ---- | ---- |
| `src/utils/md5.js` | 纯 JS 标准 MD5 计算（零依赖，RFC 1321） |
| `src/utils/busId.js` | 业务层编号还原：分片异步构建编号字典，避免阻塞 UI |

**性能设计**：完整枚举 20 万个编号需约 400ms（移动端更慢），同步执行会卡住界面。
`busId.js` 采用**分片异步构建**（每片 8000 个，`setTimeout` 让出主线程）+ 内存缓存 + 就绪回调 `onBusIdReady(cb)`。字典就绪前 `decryptBusId()` 返回 `null`，页面需用 `onBusIdReady(cb)` 二次刷新。
> ⚠️ 循环终止条件必须用 `end >= DICT_MAX`，改成 `n <= DICT_MAX` 会在 `n == DICT_MAX` 时死循环。

**编号取值范围（实测）**：纯数字字符串，覆盖 3000~3400、5200~5400、7900~7910、12400~13400、22500~22700、32100~32430、52800~53150、72500~72550 等车队批次号段，当前实测最大 72541，枚举上限设为 200000 留足余量。

**已验证的还原对照**（节选，完整见 `scripts/test-busid.mjs`）：

| 加密值 | 原始编号 |
| ------ | -------- |
| `2f9fb60d8cd21c36765ffb4c04a86f35` | 32379 |
| `d15426b9c324676610fbb01360473ed8` | 3240 |
| `fac99c77695b5655eefadf78498b8430` | 32426 |
| `cc638784cf213986ec75983a4aa08cdb` | 5263 |
| `42d0c639a21482dcd8e1c447efe87e89` | 7908 |
| `44c2630eab1d5a8bea8cef42cac127cd` | 22527 |
| `c370ec3d80532ba4afe5af93000db96e` | 52826 |
| `bed5623adc8b12bc67a4221a5d5cccc4` | 72541 |

线路详情页与地图页会直接显示还原后的自编号（如 `72502`），并附带 MD5 原值备查。

### `arrived` 字段语义（实测）

| 值 | 含义 |
| -- | ---- |
| `"1"` | 已到站（距最近站点通常 3~12m） |
| `"0"` | 行驶中（距最近站点通常 48~281m） |

---

## 六、线路详情页交互

### 站点列表：横版卡片 + 横向滚动

站点采用**横向卡片条**，可左右滑动浏览：

- 每张卡片包含：站号徽章（首站绿/末站红）+ 站名 + 地铁换乘标签 + 该站实时车辆
- 车辆卡片：`自编号 | 状态 | 时间` 一行，`车速 · 距本站距离` 一行（不折行）
- 卡片**等高**，车辆信息统一贴底对齐；左右边缘渐隐遮罩提示可横向滚动
- 营运信息（首班/末班/票价/站点数/在线数）为**横向单行**布局

> ⚠️ 实现要点：滚动容器内的内容行必须**收缩到自身宽度**才能产生滚动距离。
> uni-app H5 的 `scroll-view` 默认把内容行压到容器宽（`display:flex`），导致卡片溢出裁切而非滚动。
> 解决：内容行改用 `display: inline-flex`（shrink-to-fit）+ `min-width: 100%`（见 `line.vue` 的 `.stop-row`）。

### 线路走向总览

总览条：站点按**沿线路累计里程比例**分布（不是等距，由 `geo.js` 计算），车辆按最近站位插值定位并错开显示。

### 车辆信息位置

车辆信息**不单独成页**，直接挂在对应站点下：

- 每站下方内嵌该站车辆卡片（`matchBusesToStops` 匹配，按距离由近到远排序，多车可同站）
- 实时数据每 15 秒自动刷新（`onUnload` 时清理定时器）
- 底部提供「实时车辆 → 地图」入口

---

## 七、H5 生产部署与跨域

- **H5 开发环境**：`vite.config.js` 配置 `/api` 代理转发到武汉公交接口，规避浏览器跨域。
- **App 端**：直连真实域名，无需代理。
- **H5 生产环境**：`build:h5` 产物**没有代理**，且纯静态托管（GitHub Pages）直连会被浏览器 **CORS 预检拦截**（上游 `OPTIONS` 响应不含 CORS 头）。

**解决方案：Cloudflare Worker 反向代理**（`deploy/cloudflare-worker.js`）：

1. 在 Cloudflare 创建 Worker，把 `deploy/cloudflare-worker.js` 内容粘贴部署（免费额度 10 万请求/天）。
2. 拿到 `https://whbis-proxy.<你的子域>.workers.dev` 地址。
3. 填入 `src/config.js` 的 `APP_CONFIG.apiProxy`（末尾不带斜杠）。
4. 执行 `npm run deploy:pages` 部署到 GitHub Pages。

Worker 会为预检直接应答 `204`，转发 POST 时补全 `Access-Control-Allow-Origin`，并透传 `openId` 请求头。`apiProxy` 留空时 H5 生产回退直连真实域名（仅对无 CORS 限制的环境有用）。

**GitHub Pages 分支模型**（见 `scripts/deploy-pages.mjs`）：

- `main` —— 源码主干（`origin/main`），仓库首页展示的就是它
- `pages` —— 仅存放 H5 构建产物（`origin/pages`），Pages 从该分支根目录发布；用孤立提交强推，产物不含源码历史

---

## 八、下一步计划

- [x] 工程初始化、架构搭建、双端构建验证
- [x] 接口协议破解（POST + header openId）
- [x] MD5 车辆编号还原
- [x] 真实数据联调：线路 / 站点 / 时刻表 / 实时车辆 / 地图
- [x] H5 生产部署：Cloudflare Worker 反代 + GitHub Pages 一键部署
- [x] 地图 BYOK（用户自带高德 Key，解决内置 Key 安全问题）
- [ ] 配置高德 Key，验证 Android 真机原生地图
- [ ] 线路收藏、历史查询等本地存储能力
- [ ] 公交到站距离估算（基于 GPS 与站点坐标）
- [ ] 如需原生渲染体验，评估 nvue / uni-app x 路线