# 武汉公交信息实时查询（WuhanBus App）

基于 **uni-app（Vue 3 + Vite）** 的武汉公交信息实时查询在线营运线路信息查询应用。

**目标平台**：Android App + Web（PC/移动浏览器）
**技术栈**：uni-app 3.x / Vue 3 / Vite 5
**项目位置**：`D:\Development\Workspaces\wuhanbus-app`（与 `boundless-whbis` 平级）
**接口文档**：`D:\Development\Workspaces\boundless-whbis\武汉公交信息实时查询API接口文档.md`

---

## 一、如何启动

### 方式 A：网页版（H5）— 最快，浏览器直接看

```bash
cd D:\Development\Workspaces\wuhanbus-app
npm install          # 首次运行需要，已安装可跳过
npm run dev:h5
```

启动后终端会打印地址，浏览器打开：

```
http://localhost:5173
```

按 `Ctrl + C` 停止。

### 方式 B：Android App

**第 1 步：生成 App 资源包**

```bash
cd D:\Development\Workspaces\wuhanbus-app
npm run build:app-plus
```

产物生成在 `dist/build/app`。

**第 2 步：用 HBuilderX 出包**

1. 下载安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（Windows 版）
2. HBuilderX → 文件 → 打开目录 → 选择 `D:\Development\Workspaces\wuhanbus-app`
3. 打开 `src/manifest.json` → 可视化界面：
   - **基础配置**：填写应用名称、AppID（点"重新获取"可生成测试 AppID）
   - **App 图标配置**：可选
   - **权限配置**：定位权限已配好
   - **模块配置**：勾选 **Maps**（地图）
   - **第三方 SDK**：填写高德 Key（不填则地图页自动用"线路示意图"模式）
4. 菜单 → 发行 → **原生 App - 云打包** → 选择 Android → 打包

> 云打包需要 DCloud 账号登录。打包完成后下载安装包即可真机安装。
> 若需自定义证书/包名，在「发行 → 原生App-云打包」的高级设置里配置。

### 方式 C：运行单元测试

```bash
cd D:\Development\Workspaces\wuhanbus-app
npm run test:md5
```

### 常用命令速查

| 命令 | 作用 | 产物位置 |
| ---- | ---- | -------- |
| `npm run dev:h5` | 启动网页版开发服务器 | 内存（热更新） |
| `npm run build:h5` | 构建网页版 | `dist/build/h5` |
| `npm run build:app-plus` | 构建 Android App 资源 | `dist/build/app` |
| `npm run test:md5` | MD5 单元测试 | — |

> ⚠️ 网页版 **生产部署**需注意跨域：`dev:h5` 自带 Vite 代理，但 `build:h5` 产物没有。
> 部署时需用 Nginx 反向代理 `/api/`，具体配置见第六节。

---

## 二、目录结构

```
wuhanbus-app/
├── index.html                 # H5 入口模板
├── vite.config.js             # Vite 配置（含 H5 开发跨域代理）
├── scripts/
│   ├── test-md5.mjs           # MD5 单元测试（RFC 1321 向量 + 实测数据）
│   └── openid_sniffer.py      # mitmproxy 插件：抓取 openId（备用方案）
├── README.md
└── src/
    ├── main.js                # 应用入口
    ├── App.vue                # 全局生命周期
    ├── config.js              # ★ 应用配置（openId / cityCode / mapKey）
    ├── manifest.json          # App 打包配置（Android 权限 / 地图 SDK）
    ├── pages.json             # 路由与全局样式配置
    ├── uni.scss               # 全局 SCSS 变量
    ├── pages/
    │   ├── index/index.vue    # 首页：线路搜索 + 上下行结果卡片
    │   ├── line/line.vue      # 线路详情：站点 / 时刻表 / 实时车辆（Tab）
    │   └── map/map.vue        # 实时车辆地图（原生地图 / 线路示意图双模式）
    ├── utils/
    │   ├── api.js             # ★ 接口请求层（封装 3 个公交接口）
    │   └── md5.js             # 纯 JS MD5 实现 + 车辆编号逆向还原
    └── static/
        ├── logo.png
        └── bus-marker.png     # 地图车辆标记图标
```

---

## 三、接口协议（★ 已破解，务必照做）

完整说明见同级目录 `boundless-whbis/《武汉公交信息实时查询API接口文档.md》` 附录 0。

### 三条铁律

1. **必须 POST** + `Content-Type: application/json`（GET 不支持）
2. **openId 必须放在请求头**（header），放 query / body 一律返回 `90001 缺少openId`
3. **openId 的值服务端不校验**，任意非空 ASCII 字符串即可

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

`{cityCode}-{线路号}-{方向}`，方向 `0` / `1` 表示上下行，例：`420100-337-0`。
> 后端怪癖：响应里的 `direction` 字段与请求后缀**相反**，但 `stopDetailList` 的顺序与请求方向一致，以站点列表为准。

---

## 四、地图 Key 配置

地图页支持**双模式**，无需 key 也能跑通：

| 模式 | 触发条件 | 说明 |
| ---- | -------- | ---- |
| 原生地图 | `src/config.js` 的 `mapKey` 非空 | 使用 uni-app `<map>` 组件（高德底图） |
| 线路示意图 | `mapKey` 为空（默认） | 基于站点经纬度用 SVG 绘制线路走向 + 站点 + 实时车辆位置 |

**配置 key 的步骤**：

1. 到[高德开放平台](https://console.amap.com/dev/key/app)注册应用，取得 Key
   - H5 需选「Web服务」或「Web端(JS API)」类型
   - Android 需选「Android」类型，并配置包名与签名
2. 填入 `src/config.js`：
   ```js
   mapKey: '你的高德Key',
   ```
3. 同时把同一 Key 填入 `src/manifest.json`：
   - `h5.sdkConfigs.maps.amap.key`
   - `app-plus.distribute.sdkConfigs.maps.amap.key`
4. Android 端还需在 HBuilderX 中勾选 **Maps 模块**（`manifest.json → App 配置 → 模块配置`）

---

## 五、MD5 加密还原（`src/utils/busId.js` + `src/utils/md5.js`）

接口返回的车辆编号为标准 MD5 摘要：

```
busId = MD5( orgBusId )
```

| 模块 | 职责 |
| ---- | ---- |
| `src/utils/md5.js` | 纯 JS 标准 MD5 计算（零依赖，RFC 1321）+ 通用逆向枚举 |
| `src/utils/busId.js` | 业务层编号还原：分片异步构建编号字典，避免阻塞 UI |

**性能设计**：完整枚举 20 万个编号需约 400ms（移动端更慢），同步执行会卡住界面。
`busId.js` 采用**分片异步构建**（每片 8000 个，`setTimeout` 让出主线程）+ 内存缓存 + 就绪回调，
App 启动时通过 `warmUp()` 预热，就绪后页面自动重新还原并刷新。

**编号取值范围（实测）**：纯数字字符串，覆盖 3000~3400、5200~5400、7900~7910、
12400~13400、22500~22700、32100~32430、52800~53150、72500~72550 等车队批次号段，
当前实测最大 72541，枚举上限设为 200000 留足余量。

**已验证的还原对照**（节选）：

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

站点不再纵向堆叠，改为**横向卡片条**，可左右滑动浏览：

- 每张卡片包含：站号徽章（首站绿/末站红）+ 站名 + 地铁换乘标签 + 该站实时车辆
- 车辆卡片：`自编号 | 状态 | 时间` 一行，`车速 · 距本站距离` 一行（不折行）
- 卡片**等高**，车辆信息统一贴底对齐
- 卡片条高度 `auto`，随内容自适应，无留白
- 左右边缘渐隐遮罩提示可横向滚动
- 站号过密时卡片内容自适应换行，标题最多两行

> ⚠️ 实现要点：滚动容器内的内容行必须**收缩到自身宽度**才能产生滚动距离。
> uni-app H5 的 `scroll-view` 默认把内容行压到容器宽（`display:flex`），导致卡片溢出裁切而非滚动。
> 解决：内容行改用 `display: inline-flex`（shrink-to-fit）+ `min-width: 100%`，
> 实测 41 站内容宽度 3631px vs 容器 201px，横向滚动正常。

### 线路走向总览

新增总览条：站点按**沿线路累计里程比例**分布（不是等距），车辆按最近站位插值定位并错开显示，
一眼看出车辆在全程中的位置。

### 车辆信息位置

车辆信息**不单独成页**，而是直接挂在对应站点下：

- 新增 `src/utils/geo.js`：Haversine 球面距离计算 + 车辆↔最近站点匹配
- 每站下方内嵌该站车辆卡片
- 车辆按距离由近到远排序，多车可同站
- 实时数据每 15 秒自动刷新（`onUnload` 时清理定时器）
- 营运信息（首班/末班/票价/站点数/在线数）改为**横向单行**布局
- 底部提供「实时车辆 → 地图」入口

---

## 六、跨域处理

- **H5 开发环境**：`vite.config.js` 配置了 `/api` 代理转发到 `https://customized.wuhanbus.com/gps-resapi/wechat/bus`，规避浏览器跨域。
- **App 端**：直连真实域名，无需代理。
- ⚠️ **H5 生产构建**无代理，需在部署层做反向代理（Nginx 示例见下），或改用同源后端转发。

```nginx
# Nginx 反向代理示例
location /api/ {
    proxy_pass https://customized.wuhanbus.com/gps-resapi/wechat/bus/;
    proxy_set_header Host customized.wuhanbus.com;
    proxy_set_header openId $http_openid;
}
```

> 注意：`openId` 是自定义请求头，代理时需显式透传（`proxy_set_header openId $http_openid;`）。

---

## 七、下一步计划

- [x] 工程初始化、架构搭建、双端构建验证
- [x] 接口协议破解（POST + header openId）
- [x] MD5 车辆编号还原
- [x] 真实数据联调：线路 / 站点 / 时刻表 / 实时车辆 / 地图
- [ ] 配置高德 Key，验证 Android 真机原生地图
- [ ] 线路收藏、历史查询等本地存储能力
- [ ] 公交到站距离估算（基于 GPS 与站点坐标）
- [ ] 如需原生渲染体验，评估 nvue / uni-app x 路线
