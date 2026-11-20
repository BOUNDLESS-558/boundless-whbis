# 武汉公交信息实时查询在线营运线路信息 API 接口文档

> 数据来源：`https://customized.wuhanbus.com/gps-resapi/wechat/bus/...`（一 ~ 六章）
> 服务端：`nginx/1.20.1`，请求/返回格式均为 `application/json`（UTF-8）。
> 本项目实测来源：`src/utils/api.js`（请求层封装）、`src/config.js`（鉴权与公共参数）、`API信息.txt`（原始抓包数据）。
> 本版文档为对项目实际调用 API 的全面整理，字段说明与示例均来自真实抓包与联调实测（2026-10-22）。

---

## 目录

| 序号 | 接口用途 | 请求方法 | 请求路径 | 项目封装函数 |
| ---- | -------- | -------- | -------- | ------------ |
| 1 | 获取线路及站点信息（基础信息 + 全部站点 + 换乘） | POST | `/bus/line` | `fetchLine(lineCode)` |
| 2 | 获取在线运营车辆实时信息（GPS，车辆编号 MD5 加密） | POST | `/bus/detailData` | `fetchRealTime(lineId)` |
| 3 | 获取计划营运车辆信息（发车计划/时刻表） | POST | `/bus/detailPlanTime` | `fetchPlanTime(lineId)` |
| 4 | 获取站点实时信息（途经线路 + 即将到站车辆） | POST | `/bus/station` | —（待接入 `fetchStation(stopId)`） |
| — | 附录 A：实时数据字段完整说明 | — | — | — |
| — | 附录 B：部署与跨域 | — | — | — |
| — | 附录 C：高德地图站点坐标与线路走向采集（含 C.2.4 兼容模式 `getPoiNewbus`） | — | — | — |
| — | └ C.3.0.2 原理：跨接口共用 POI id 的推导链 | — | — | — |
| — | └ C.6.7 更新站点信息：完整复现流程（标准作业程序） | — | — | — |

**基础地址（BASE URL）**：`https://customized.wuhanbus.com/gps-resapi/wechat/bus`

> ⚠️ 渠道路径唯一：仅 `/gps-resapi/wechat/**` 存在，`app`/`h5`/`pc`/`web`/`mini` 等兄弟路径均返回 `3008 资源不存在`；`gps-resapi` 为该主机唯一 API 前缀。

### 项目内的调用地址（环境差异）

`src/utils/api.js` 通过 uni-app 条件编译区分两套地址：

| 环境 | BASE 地址 | 说明 |
| ---- | --------- | ---- |
| H5 开发（`dev:h5`） | `/api` | 由 `vite.config.js` 代理：`/api` → `https://customized.wuhanbus.com/gps-resapi/wechat/bus`（`changeOrigin` + 路径重写），规避浏览器跨域 |
| App / 其它端 | `https://customized.wuhanbus.com/gps-resapi/wechat/bus` | 直连真实域名，无需代理 |
| H5 生产构建 | 需在部署层做 Nginx 反向代理（见文末「部署与跨域」） | 构建产物不含 dev 代理 |

---

## 一、通用请求协议（★ 实测破解，三个接口共用）

### 三条铁律

1. **必须 POST** + `Content-Type: application/json`（GET 返回 `code:3008 访问的资源不存在`）
2. **`openId` 必须放在请求头（header）**，放 query / body 一律返回 `code:90001 缺少openId`
3. **`openId` 的值服务端不校验**，任意非空 ASCII 字符串即可（真实小程序里是微信 openId）

### 通用请求样例

```http
POST /gps-resapi/wechat/bus/line HTTP/1.1
Host: customized.wuhanbus.com
Content-Type: application/json
openId: wx_openid_dev_001          ← ★ 必须在 header，不能放 query/body

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

### 通用请求参数（body）

以下公共字段由 `src/config.js` 的 `APP_CONFIG` 统一提供（`api.js` 的 `baseBody()` 自动合并进每个请求），来自真实抓包，**除 `cityCode` 外服务端均可缺省**，保留仅为贴近真实请求：

| 参数 | 位置 | 必填 | 类型 | 说明 | 项目当前值 |
| ---- | ---- | ---- | ---- | ---- | ---------- |
| `openId` | **header** | ✅ | String | 鉴权标识。服务端只检查「是否存在且非空」，**不校验值**；须为 ASCII（含中文会报 `Header 'openId' has invalid value`） | `wx_openid_dev_001` |
| `cityCode` | body | ✅ | String | 城市编码，武汉为 `420100` | `420100` |
| `lineCode` | body | ✅（仅 `/line`） | String | 线路编码，格式 `{cityCode}-{线路号}-{方向0\|1}`，如 `420100-337-0` | 由 `buildLineCode(lineNo, dir)` 生成 |
| `lineId` | body | ✅（仅 `/detailPlanTime`、`/detailData`） | String | 与 `lineCode` 同格式，**参数名不同，不可混用** | 同上 |
| `destinationId` | body | ✅（仅 `/station`） | String | 站点加密 ID，**等于 `/line` 响应 `stopDetailList[].stopId`**（本身已是 32 位十六进制加密值，**不是** `MD5(stopId)`，实测 `MD5(stopId)` 会报 `code:-1 站点信息未找到`） | 由 `/line` 响应取得 |
| `xiaomaAppId` | body | ❌ | String | 小码平台 AppID（微信小程序 AppID） | `wxaa1d01cdc96a2c0c` |
| `appKey` | body | ❌ | String | 客户端标识 | `A0CADFE6F3B914A2` |
| `appType` | body | ❌ | Integer | 应用类型（抓包值） | `4` |
| `codeType` | body | ❌ | Integer | 编码类型（抓包值） | `1` |
| `channelId` | body | ❌ | Integer | 渠道号（抓包值） | `23000003` |
| `appSource` | body | ❌ | Integer | 来源标识（抓包值） | `2` |

> 项目调用超时：`api.js` 中统一 `timeout: 15000`（15 秒）。

### 通用响应外层结构（三个接口共用）

| 字段 | 类型 | 用途说明 |
| ---- | ---- | -------- |
| `success` | Boolean | 是否成功，`true` 表示成功（`api.js` 以此 + `msg.code` 双重判断） |
| `msg` | Object | 消息/状态信息对象 |
| `msg.code` | String | 状态码，`"20000"` 表示请求成功；错误码见「错误码速查」 |
| `msg.message` | String | 状态描述，如 `"请求成功"` |
| `data` | Object / Array | 业务数据主体，每个接口结构不同，详见下文 |

`api.js` 的 `post()` 封装在 `success === true && msg.code === '20000'` 时 resolve `payload.data`，否则以 `msg.message` reject。

### 错误码速查

| code | 含义 | 触发场景（实测） |
| ---- | ---- | ---------------- |
| `20000` | 请求成功 | 正常响应 |
| `3008` | 访问的资源不存在 | 用 GET 请求；或使用不存在的渠道路径/接口前缀 |
| `3014` | 参数校验失败 | 缺 `cityCode`（`cityCode:城市编码不能为空`）；`/line` 传错参数名（`lineCode:线路ID不能为空`）；`/detailPlanTime`、`/detailData` 传错参数名（`lineId:线路id不能为空`）；线路号不存在（`线路找不到`） |
| `90001` | 缺少 openId | header 未带 `openId`，或将 openId 放在 query / body，或 header 值为空 |
| `-1` | 站点信息未找到 | `/station` 的 `destinationId` 不是有效站点 id（如误用 `MD5(stopId)` 而非原始 `stopId`） |

### 鉴权相关实测结论

| 验证项 | 结果 |
| ------ | ---- |
| openId 值是否校验 | ❌ 不校验。`x`、`abc123`、`0`、标准 28 位微信 openId 格式均可通过 |
| 参数名变体（`openid`/`open_id`/`uid`/`userId`） | 全部无效 |
| 其它 header 名（token/authorization/sessionid/ticket/jwt 等 15 个） | 全部无效 |
| 登录/签发端点 | 不存在（探测 36 个候选路径，30 个 404，其余均被同一 openId 过滤器拦截） |
| 会话机制 | 无 `Set-Cookie`、无 token 字段，纯 header 鉴权 |

### 线路编码与方向约定

- 编码规则：`{cityCode}-{线路号}-{方向}`，如 `420100-337-0`；方向 `0` / `1` 表示上/下行（同一线路两个方向需分别调用查询）。
- 项目中由 `src/config.js` 的 `buildLineCode(lineNo, direction)` 统一生成。
- **后端怪癖**：`/line` 响应中 `lineDetailBaseDto.direction` 字段的值与请求后缀**相反**（如请求 `-0` 返回 `420100-337-1`），但 `lineId` 字段与请求一致，且 `stopDetailList` 的站点顺序与请求方向一致。**以请求编码和站点列表为准**（首页 `index.vue` 即以请求编码覆盖响应 direction）。

---

## 二、接口 1：获取线路及站点信息

- **请求地址**：`POST https://customized.wuhanbus.com/gps-resapi/wechat/bus/line`
- **H5 开发地址**：`POST /api/line`（vite 代理）
- **用途**：获取某条线路某方向的基础信息（起讫站、首末班时间、票价、线路类型）以及该方向全部站点详情（站名、经纬度、序号、地铁换乘信息）。是线路详情页、地图页的数据基础。
- **项目封装**：`fetchLine(lineCode)` → `src/utils/api.js`；**首页用它做线路搜索**（对方向 0/1 各查一次，无独立搜索接口）。

### 请求 body（完整示例）

```json
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

> 响应较大（337 路 29 站约 5KB+，服务端 gzip 压缩），`Vary: Origin` 等 CORS 头由服务端返回。

### 响应 `data` 结构

`data` 为对象，包含两个子字段：

| 字段 | 类型 | 用途说明 |
| ---- | ---- | -------- |
| `lineDetailBaseDto` | Object | 线路基础信息对象 |
| `stopDetailList` | Array | 站点详情列表（按行车顺序排列，顺序与请求方向一致） |

#### ① `lineDetailBaseDto`（线路基础信息）字段

| 字段 | 类型 | 用途 | 示例值 |
| ---- | ---- | ---- | ------ |
| `lineId` | String | 线路 ID（与请求 `lineCode` 同格式，实际返回值为**另一方向**的编码，见下方说明） | `"420100-337-0"` |
| `lineName` | String | 线路名称/编号 | `"337"` |
| `direction` | String | 方向标识，格式同线路编码 | `"420100-337-1"`（⚠️ 与请求后缀相反，后端怪癖） |
| `startStop` | String | 起点站站名 | `"汉城路公交停车场"` |
| `endStop` | String | 终点站站名 | `"汉新大道公交停车场"` |
| `earlyHour` | String | 首班车时间（HH:mm） | `"06:00"` |
| `lastHour` | String | 末班车时间（HH:mm） | `"21:00"` |
| `runTimes` | String | 运营时段描述（⚠️ 值前有空格，展示时需 trim） | `" 06:00-21:00"` |
| `price` | String | 票价（元） | `"2"` |
| `lineType` | Integer | 线路类型，`0` 为常规公交线路（其他值待确认） | `0` |

> **`lineId` 与 `direction` 的怪癖**：实测请求 `420100-337-0` 时返回 `direction: "420100-337-1"`、`lineId: "420100-337-0"`；请求 `-1` 时恰好互换。两字段一个等于请求编码、一个是反向编码，语义不可靠，**方向请以请求编码后缀为准**。

#### ② `stopDetailList`（站点列表）元素字段

| 字段 | 类型 | 用途 | 示例值 |
| ---- | ---- | ---- | ------ |
| `stopId` | String | 站点唯一 ID（32 位十六进制大写字符串；个别站点为纯数字 ID） | `"6BFD20EF4F7381402D7CC76F8D1F83A5"`、`"177747906667391694"` |
| `stopName` | String | 站点名称 | `"芳草二街汉城路"` |
| `stopNo` | Integer | 站点序号（`1` 为首站，按行车顺序递增；同一线路两方向序号独立） | `4` |
| `latitude` | String | 纬度（WGS 坐标字符串，6 位小数精度） | `"30.532726"` |
| `longitude` | String | 经度（同上） | `"114.198472"` |
| `transferInfos` | Array（可选） | 换乘信息列表，仅可换乘地铁的站点存在该字段 | 见下 |

##### `transferInfos` 元素字段（地铁换乘信息）

| 字段 | 类型 | 用途 | 示例值 |
| ---- | ---- | ---- | ------ |
| `subwayLineNo` | String | 可换乘的地铁线路编号 | `"3"`、`"6"` |
| `stopName` | String | 换乘关联站点名称（通常与本站同名） | `"芳草二街汉城路"` |
| `statId` | String | 换乘关联站点 ID（⚠️ 注意拼写是 `statId` 不是 `stationId`；实测与本站 `stopId` 相同） | `"CF7DEA1D35F1D24FE494794EFF9ED49F"` |
| `iconUrl` | String | 地铁线路标识图标 URL（相对宿主站可区分线路配色） | `"https://customized.wuhanbus.com/minio/whbus/inner_img_upload_1703070897675.png"` |

> 图标 URL 实测规律：`inner_img_upload_1703070897675.png` 对应地铁 3 号线，`inner_img_upload_1703070939719.png` 对应地铁 6 号线。首页/详情页/地图页均只用 `subwayLineNo` 渲染换乘徽章，未直接使用该图片。

### 响应示例（337 路上行 `420100-337-0`，站点节选）

```json
{
  "data": {
    "lineDetailBaseDto": {
      "direction": "420100-337-1",
      "earlyHour": "06:00",
      "endStop": "汉新大道公交停车场",
      "lastHour": "21:00",
      "lineId": "420100-337-0",
      "lineName": "337",
      "lineType": 0,
      "price": "2",
      "runTimes": " 06:00-21:00",
      "startStop": "汉城路公交停车场"
    },
    "stopDetailList": [
      {
        "latitude": "30.536172",
        "longitude": "114.203409",
        "stopId": "6BFD20EF4F7381402D7CC76F8D1F83A5",
        "stopName": "汉城路公交停车场",
        "stopNo": 1
      },
      {
        "latitude": "30.532726",
        "longitude": "114.198472",
        "stopId": "CF7DEA1D35F1D24FE494794EFF9ED49F",
        "stopName": "芳草二街汉城路",
        "stopNo": 4,
        "transferInfos": [
          {
            "iconUrl": "https://customized.wuhanbus.com/minio/whbus/inner_img_upload_1703070897675.png",
            "statId": "CF7DEA1D35F1D24FE494794EFF9ED49F",
            "stopName": "芳草二街汉城路",
            "subwayLineNo": "3"
          }
        ]
      },
      {
        "latitude": "30.516742",
        "longitude": "114.248827",
        "stopId": "C5B63C8624A5A3E07AF34847797C72B7",
        "stopName": "汉新大道公交停车场",
        "stopNo": 29
      }
    ]
  },
  "msg": { "code": "20000", "message": "请求成功" },
  "success": true
}
```

### 项目内使用位置

- `src/pages/index/index.vue`：搜索线路，`for dir of [0,1]` 两次调用，结果卡片展示 `lineName / startStop / endStop / runTimes / price / stopCount`（`stopCount = stopDetailList.length`，接口本身不返回站数）。
- `src/pages/line/line.vue`：拉取站点列表，渲染横向站点卡片条与线路走向总览。
- `src/pages/map/map.vue`：拉取站点坐标，用于原生地图标记或 SVG 线路示意图。

---

## 三、接口 2：获取在线运营车辆实时信息（实时 GPS）

- **请求地址**：`POST https://customized.wuhanbus.com/gps-resapi/wechat/bus/detailData`
- **H5 开发地址**：`POST /api/detailData`（vite 代理）
- **用途**：获取某条线路某方向**当前在线运营**（正在路上行驶）的车辆实时信息：GPS 坐标、车速、定位时间、到站状态、班次序号。用于线路详情页的「实时车辆」Tab 与地图页车辆定位。
- **实时性**：秒级 GPS（`gpsTime` 精确到秒）；项目中详情页每 15 秒轮询一次。
- **⚠️ 加密说明**：`busId`/`busNo` 为 `MD5(orgBusId)` 加密值，**已破解**，还原方法见附录 A。
- **项目封装**：`fetchRealTime(lineId)` → `src/utils/api.js`（注意 body 参数名是 `lineId`，不是 `lineCode`）。

### 请求 body（完整示例）

```json
{
  "cityCode": "420100",
  "lineId": "420100-337-0",
  "xiaomaAppId": "wxaa1d01cdc96a2c0c",
  "appKey": "A0CADFE6F3B914A2",
  "appType": 4,
  "codeType": 1,
  "channelId": 23000003,
  "appSource": 2
}
```

### 响应 `data` 结构

`data` 为对象，包含两个子字段：

| 字段 | 类型 | 用途说明 |
| ---- | ---- | -------- |
| `lineBusDtoList` | Array | 在线运营车辆列表（空数组表示当前无在线车辆） |
| `plans` | Array\<String\> | 计划发车时间列表（HH:mm 格式），如 `["07:40","08:05"]`；随时间滚动，只保留临近班次 |

#### `lineBusDtoList` 元素字段

| 字段 | 类型 | 用途 | 示例值 |
| ---- | ---- | ---- | ------ |
| `busId` | String | 车辆 ID，`MD5(orgBusId)` 加密值（32 位小写十六进制），与 `busNo` 相同；还原见附录 A | `"040a99f23e8960763e680041c601acab"`（→ `3228`） |
| `busNo` | String | 车辆编号（加密值，实测与 `busId` 恒等） | 同上 |
| `busOrder` | String | 车辆当前发车顺序/班次序号（从 1 起，对应线路车辆排班序） | `"15"` |
| `busType` | String | 车辆类型编码（含义待确认，实测样本均为 `"11"`） | `"11"` |
| `arrived` | String | 到站状态：`"1"` 已到站 / `"0"` 行驶中（实测语义见下表） | `"1"` |
| `gpsSpeed` | String | 当前车速（km/h），停车时为 `"0"` | `"19"` |
| `gpsTime` | String | GPS 定位时间（`yyyyMMddHHmmss` 格式，注意与其它接口时间格式不同） | `"20261022073648"` |
| `latitude` | String | 纬度（高精度浮点字符串，13~14 位有效数字） | `"30.51634426297664"` |
| `longitude` | String | 经度（同上） | `"114.20659988885878"` |

#### `arrived` 字段语义（实测确认）

| 值 | 含义 | 实测特征 |
| -- | ---- | -------- |
| `"1"` | **已到站** | 距最近站点 3 ~ 12m（在站上），或刚离站正在加速 |
| `"0"` | **行驶中** | 距最近站点 48 ~ 281m（位于两站之间） |

> 采样依据：2026-10-22 09:46 采集 5 条线路共 13 辆在线车辆，`arrived=1` 的 5 辆距站 192m/12m/10m/3m/3m，`arrived=0` 的 8 辆为 281m/96m/99m/68m/69m/243m/48m/98m。

### 响应示例（337 路上行，真实抓包）

```json
{
  "data": {
    "lineBusDtoList": [
      {
        "arrived": "1",
        "busId": "040a99f23e8960763e680041c601acab",
        "busNo": "040a99f23e8960763e680041c601acab",
        "busOrder": "15",
        "busType": "11",
        "gpsSpeed": "19",
        "gpsTime": "20261022073648",
        "latitude": "30.51634426297664",
        "longitude": "114.20659988885878"
      },
      {
        "arrived": "1",
        "busId": "fac99c77695b5655eefadf78498b8430",
        "busNo": "fac99c77695b5655eefadf78498b8430",
        "busOrder": "28",
        "busType": "11",
        "gpsSpeed": "0",
        "gpsTime": "20261022073648",
        "latitude": "30.51780982475968",
        "longitude": "114.25091825509178"
      }
    ],
    "plans": ["07:40", "08:05"]
  },
  "msg": { "code": "20000", "message": "请求成功" },
  "success": true
}
```

### 项目内使用位置与后处理

- `src/pages/line/line.vue`、`src/pages/map/map.vue`：15 秒轮询（`onUnload` 清理定时器）。
- 车辆坐标字符串转数字后写入 `lat/lng`，经 `src/utils/geo.js` 的 `matchBusesToStops()` 用 Haversine 球面距离匹配到最近站点，得到 `nearestStopIndex / distance / distanceText`。
- `busId` 经 `src/utils/busId.js` 的 `decryptBusId()` 还原为自编号（如 `3228`）展示，字典未就绪时先显示空/原值，就绪回调后自动刷新。

---

## 四、接口 3：获取计划营运车辆信息（发车计划/时刻表）

- **请求地址**：`POST https://customized.wuhanbus.com/gps-resapi/wechat/bus/detailPlanTime`
- **H5 开发地址**：`POST /api/detailPlanTime`（vite 代理）
- **用途**：获取某条线路某方向的计划发车班次信息（哪辆车、几点发车、第几班）。用于线路详情页的「时刻表」Tab。
- **项目封装**：`fetchPlanTime(lineId)` → `src/utils/api.js`（body 参数名是 `lineId`）。

### 请求 body（完整示例）

```json
{
  "cityCode": "420100",
  "lineId": "420100-337-0",
  "xiaomaAppId": "wxaa1d01cdc96a2c0c",
  "appKey": "A0CADFE6F3B914A2",
  "appType": 4,
  "codeType": 1,
  "channelId": 23000003,
  "appSource": 2
}
```

### 响应 `data` 结构

`data` 为**数组**（注意：不是对象），每个元素代表一辆计划发车的车辆：

| 字段 | 类型 | 用途 | 示例值 |
| ---- | ---- | ---- | ------ |
| `busId` | String | 车辆 ID（`MD5(orgBusId)` 加密值，与 `busNo` 相同） | `"2f9fb60d8cd21c36765ffb4c04a86f35"` |
| `busNo` | String | 车辆编号（加密值，与 `busId` 相同） | 同上 |
| `orgBusId` | String | ★ **原始车辆 ID（明文，未加密）**，纯数字字符串 | `"32379"` |
| `orgBusNo` | String | 原始车辆编号（明文，实测与 `orgBusId` 相同） | `"32379"` |
| `planStartTime` | String | 计划发车时间（HH:mm） | `"07:40"` |
| `planTime` | String | 计划发车完整时间（`yyyy-MM-dd HH:mm:ss`） | `"2026-10-22 07:40:00"` |
| `rid` | String | 线路编码 + 方向（格式同 `lineCode`，与请求方向一致） | `"420100-337-0"` |
| `startOrder` | Integer | 发车顺序/班次序号 | `1` |

> 🔑 **加密破解的关键**：本接口同时返回加密值（`busId`）与明文（`orgBusId`），是验证 `busId = MD5(orgBusId)` 的直接证据；也是项目中「已知对照表」（`busId.js` 的 `KNOWN_BUS_IDS`）的数据来源之一。
> ⚠️ 实测返回班次数量有限（样本仅 1~2 条），且同一响应中不同车辆可出现相同 `startOrder`（如两辆车均为 `1`），并非完整全天时刻表；完整班次间隔可参考 `/detailData` 的 `plans` 字段。

### 响应示例（337 路上行，真实抓包）

```json
{
  "data": [
    {
      "busId": "2f9fb60d8cd21c36765ffb4c04a86f35",
      "busNo": "2f9fb60d8cd21c36765ffb4c04a86f35",
      "orgBusId": "32379",
      "orgBusNo": "32379",
      "planStartTime": "07:40",
      "planTime": "2026-10-22 07:40:00",
      "rid": "420100-337-0",
      "startOrder": 1
    },
    {
      "busId": "d15426b9c324676610fbb01360473ed8",
      "busNo": "d15426b9c324676610fbb01360473ed8",
      "orgBusId": "3240",
      "orgBusNo": "3240",
      "planStartTime": "08:05",
      "planTime": "2026-10-22 08:05:00",
      "rid": "420100-337-0",
      "startOrder": 1
    }
  ],
  "msg": { "code": "20000", "message": "请求成功" },
  "success": true
}
```

### 项目内使用位置

- `src/pages/line/line.vue`「时刻表」Tab：调用 `fetchPlanTime(this.lineCode)` 展示计划发车班次。

---

## 五、字段取值说明与注意事项汇总

1. **方向 `-0` / `-1`**：区分线路上下行，同一线路两方向的站点列表、`stopId` 均不同（同名站点在两方向是不同 ID），需分别调用。响应 `direction` 字段与请求后缀相反（后端怪癖），以请求编码为准。
2. **参数名差异（最易踩坑）**：`/line` 用 **`lineCode`**，`/detailPlanTime`、`/detailData` 用 **`lineId`**；混用报 `code:3014`。
3. **时间格式三种**：
   - `planStartTime` / `plans` / `earlyHour` / `lastHour` / `runTimes`：`HH:mm` 或含 HH:mm 的区间串
   - `planTime`：`yyyy-MM-dd HH:mm:ss`
   - `gpsTime`：`yyyyMMddHHmmss`（无分隔符）
4. **坐标精度差异**：站点经纬度为 6 位小定点字符串；车辆 GPS 为 13~14 位有效数字的浮点字符串。使用前均需 `parseFloat`。
5. **加密字段分布**：仅 `busId`、`busNo` 加密（`/detailData` 无明文字段；`/detailPlanTime` 附带 `orgBusId`/`orgBusNo` 明文）。
6. **`runTimes` 前导空格**、**`transferInfos.statId` 拼写**为服务端小瑕疵，解析时注意。
7. **`data` 顶层类型不一致**：`/line`、`/detailData` 返回对象，`/detailPlanTime` 返回数组，封装时不能统一按对象处理（`api.js` 直接透传 `payload.data`）。

## 六、三接口协作流程

获取某条线路完整实时运营数据的项目标准调用链（`line.vue` / `map.vue` 均此模式）：

```
buildLineCode(lineNo, dir)            ← src/config.js
   │
   ├─ ① POST /line     { lineCode }   → 线路基础信息 + 全部站点（坐标/换乘）→ 渲染站点列表/示意图底稿
   ├─ ② POST /detailData   { lineId } → 在线车辆 GPS + plans → 15s 轮询，geo.js 匹配最近站点，busId.js 还原自编号
   └─ ③ POST /detailPlanTime { lineId } → 计划发车班次 → 时刻表 Tab
```

---

## 附录 A：车辆编号 MD5 加密还原方案（已破解）

### 加密机制

`/detailData` 与 `/detailPlanTime` 中的 `busId` / `busNo` 是对**内部原始车辆编号（纯数字字符串）**的标准 MD5 摘要：

```
busId = busNo = MD5( orgBusId )     // 无盐、无前缀
```

### 验证过程

1. `/detailPlanTime` 同时返回加密值与明文，本地 MD5 验证：`MD5("32379") = 2f9fb60d8cd21c36765ffb4c04a86f35` ✓、`MD5("3240") = d15426b9c324676610fbb01360473ed8` ✓
2. 在线 MD5 反查库破解 `/detailData` 其余哈希并本地复验，7/7 吻合。
3. 扩大样本至 36 辆线上车辆，纯数字枚举 **0 ~ 400000**，36/36 全部命中。

### 内部编号取值范围（实测）

| 号段 | 实测样例 | | 号段 | 实测样例 |
| ---- | -------- - | ---- | ---- | -------- |
| 3000 ~ 3400 | 3228、3240、3306 | | 22500 ~ 22700 | 22514、22527、22675、22683 |
| 5200 ~ 5400 | 5263、5302 | | 32100 ~ 32430 | 32195、32379、32415、32426 |
| 7900 ~ 7910 | 7904、7906、7907、7908 | | 52800 ~ 53150 | 52811、52826、53026、53144 |
| 12400 ~ 13400 | 12426、12447、12882、13325 | | 72500 ~ 72550 | 72502、72507、72512、72541 |

> 实测最大编号 `72541`；项目枚举上限 `DICT_MAX = 200000`，留足余量。

### 解密对照表（抓包涉及的车辆）

| 加密值 `busId` / `busNo` | 原始编号 `orgBusId` | 出现接口 |
| --- | --- | --- |
| `2f9fb60d8cd21c36765ffb4c04a86f35` | `32379` | detailPlanTime |
| `d15426b9c324676610fbb01360473ed8` | `3240` | detailPlanTime |
| `fac99c77695b5655eefadf78498b8430` | `32426` | detailPlanTime / detailData |
| `040a99f23e8960763e680041c601acab` | `3228` | detailData |
| `6623f60e12e3d40244a0a59f4f765695` | `32195` | detailData |
| `5003307d211c815c97cc8bada9c6edec` | `32415` | detailData |
| `16fc18d787294ad5171100e33d05d4e2` | `3306` | detailData |
| `cc638784cf213986ec75983a4aa08cdb` | `5263` | detailData（线上） |
| `b7046757c3682a28c5bf2024e57678a0` | `5302` | detailData（线上） |
| `42d0c639a21482dcd8e1c447efe87e89` | `7908` | detailData（线上） |
| `165fdc9623e63b94742e6dd07b81e45b` | `12447` | detailData（线上） |
| `44c2630eab1d5a8bea8cef42cac127cd` | `22527` | detailData（线上） |
| `c370ec3d80532ba4afe5af93000db96e` | `52826` | detailData（线上） |
| `57f2b3cf26b3d12b9ecd389b401a1300` | `53144` | detailData（线上） |
| `94edfc18161ac941c9f613d290a159f6` | `72502` | detailData（线上） |
| `bed5623adc8b12bc67a4221a5d5cccc4` | `72541` | detailData（线上） |

### 项目还原实现（`src/utils/md5.js` + `src/utils/busId.js`）

- `md5.js`：零依赖纯 JS 标准 MD5（RFC 1321），单元测试 `npm run test:md5`（含 RFC 向量与实测数据）。
- `busId.js`：业务还原层——**分片异步构建**编号字典（`MD5(编号) → 编号`，每片 8000 个、`setTimeout` 让出主线程，全量 20 万约数百 ms）＋ 内置已知对照表即时命中 ＋ `warmUp()` 启动预热 ＋ `onBusIdReady()` 就绪回调驱动 UI 二次刷新。
- API：`decryptBusId(hash)` 单个还原（返回 `string|null`）、`decryptBusIds(hashes)` 批量还原。
- 显示规则：线路详情页/地图页直接展示还原后的自编号（如 `72502`），并附 MD5 原值备查。

> ⚠️ MD5 为不可逆摘要，"还原"本质是**枚举碰撞**（编号空间小所以可行）。若服务端未来加盐或改用非数字编号，此方案失效，需重新逆向。

---

## 附录 B：部署与跨域

- **H5 开发**：`vite.config.js` 已代理 `/api` → `https://customized.wuhanbus.com/gps-resapi/wechat/bus`，无需额外处理。
- **App 端**：直连真实域名，无跨域问题。
- **H5 生产**：构建产物无代理，需 Nginx 反向代理；`openId` 为自定义请求头，代理时须显式透传：

```nginx
location /api/ {
    proxy_pass https://customized.wuhanbus.com/gps-resapi/wechat/bus/;
    proxy_set_header Host customized.wuhanbus.com;
    proxy_set_header openId $http_openid;
}
```

---

## 附录 C：高德地图站点坐标与线路走向采集

> 本附录说明项目如何通过**高德地图 Web 服务 API** 获取站点坐标与线路走向信息，
> 以及后续线路更新时的操作流程。与附录 A（武汉公交实时 API）不同，本附录的数据
> **仅用于离线一次性采集**，产物以静态资产形式存在，运行时零调用、不消耗配额。

### C.0 静态资产数据结构

每个分片文件（`bNN.json` / `CCBNN.json` / `MLBNN.json` / `HQBNN.json`）为 JSON 对象：

```json
{
  "updated": "2026-11-09T00:27:10.413Z",
  "version": 1,
  "lines": {
    "<线路号>": {
      "no": "<线路号>",
      "dirs": {
        "0": {  /* 方向 0（上行） */ },
        "1": {  /* 方向 1（下行） */ }
      }
    }
  }
}
```

#### 方向对象字段

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `base` | Object | 线路基本信息（见下） |
| `stops` | Array | 站点列表（见下） |
| `route` | Array | 走向坐标串，展平 `[lng,lat,lng,lat,...]`（GCJ-02） |
| `snapped` | Boolean | 是否已贴路（true = 高德官方轨迹 / OSRM 吸附完成） |
| `source` | String | 数据来源：`'amap'`（高德官方）或 `'osrm'`（驾车路网近似） |
| `algo` | Number | 算法版本号 |
| `company` | String | 营运公司缩写（JT / CC / ML / HQ） |

#### base 字段

| 字段 | 说明 |
| ---- | ---- |
| `startStop` | 起点站名 |
| `endStop` | 终点站名 |
| `earlyHour` | 首班车时间（`HHmm`） |
| `lastHour` | 末班车时间（`HHmm`） |
| `price` | 票价 |
| `lineName` | 线路全名（含起讫站） |

#### stops 数组元素

| 字段 | 说明 |
| ---- | ---- |
| `stopNo` | 站序（从 1 起） |
| `stopId` | 站点 ID（集团：`bNN+序号`；非集团：`${abbr}B${序号}`，如 `CCB0001`） |
| `stopName` | 站名 |
| `longitude` | ★ 站点经度（GCJ-02，6 位小数 ≈ 0.1m 精度） |
| `latitude` | ★ 站点纬度（GCJ-02，6 位小数） |
| `originId` | 高德原始 POI id（`BV...`），备查用 |

### C.1 为什么需要高德

武汉公交实时 API（附录 A）只覆盖**武汉公交集团**线路。武汉还有**蔡城公交（C 线）**、
**木兰公交（P 线）**、**汉奇公交**等独立营运主体，其站点与走向需通过高德地图获取：

| 数据需求 | 武汉公交实时 API | 高德地图 |
| -------- | --------------- | -------- |
| 集团线路站点坐标 | ✅ `/line` 返回 GCJ-02 | ✅ 也可获取（用于修正/补强） |
| 集团线路走向几何 | ❌ 不返回 polyline | ✅ `/v3/bus/linename` 返回官方轨迹 |
| 非集团线路站点坐标 | ❌ 不覆盖 | ✅ `/v3/bus/linename` / `/v3/bus/lineid` |
| 非集团线路走向几何 | ❌ 不覆盖 | ✅ polyline |
| 实时车辆 GPS | ✅ `/detailData` | ❌ 无实时数据 |

因此：**站点坐标**走 A+B 混合（高德官方轨迹优先，OSRM 驾车近似兜底）；
**实时车辆**仍走武汉公交实时 API。

### C.2 高德 API 端点与调用方式（三种模式）

#### C.2.1 鉴权

- **Key**：高德 Web 服务 Key，仅本地一次性采集用，**不进前端代码、不提交仓库**。
  通过环境变量 `AMAP_KEY` 注入（PowerShell: `$env:AMAP_KEY="你的Key"`）。
- **签名**（可选）：若 Key 开启了签名校验，还需设置 `AMAP_SECRET`（安全密钥）。
  签名规则：所有参数（不含 key/sig）按名升序拼成 `k=v&...`，追加安全密钥后取 MD5 小写。
- **坐标系**：高德返回的是 **GCJ-02**（火星坐标系），与武汉公交 API、高德瓦片底图一致，
  落盘时**无需转换**，直接使用。

#### C.2.2 主链路：`/v3/bus/linename`

```
GET https://restapi.amap.com/v3/bus/linename
```

| 参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `key` | ✅ | 高德 Web 服务 Key |
| `keywords` | ✅ | 线路号，如 `337`、`C1`、`P2` |
| `city` | ✅ | 城市名，`武汉` |
| `extensions` | ✅ | `all`（返回 polyline + busstops） |
| `citylimit` | ❌ | `true`（限制在该城市） |
| `output` | ❌ | `json`（默认） |

**响应关键字段**（`buslines` 数组元素）：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `name` | String | 线路全名，如 `337路(汉城路公交停车场--汉新大道公交停车场)` |
| `start_stop` | String | 起点站名 |
| `end_stop` | String | 终点站名 |
| `polyline` | String | ★ 走向坐标串，格式 `lng,lat;lng,lat;...`（GCJ-02） |
| `busstops` | Array | 官方站点列表 |
| `busstops[].name` | String | 站名 |
| `busstops[].location` | String | `"lng,lat"` 坐标 |
| `busstops[].sequence` | Integer | 站序（从 1 起） |
| `busstops[].id` | String | 站点 POI id |
| `start_time` | String | 首班车 `HHmm` |
| `end_time` | String | 末班车 `HHmm` |
| `basic_price` | String | 票价 |
| `company` | String | 公交公司名 |
| `id` | String | 线路 POI id |

**日配额**：免费额度 1000~5000 次/天。耗尽时返回 `infocode=10044`，
此时自动切换备用链路（见 C.2.3），两条链路配额池独立。

#### C.2.3 备用链路：`/v3/assistant/inputtips` → `/v3/bus/lineid`

用于**汉奇公交**（线路名是中文前缀，如 `汉奇K6路`、`汉奇定制公交1号线`），
`linename` 按数字关键词查不到，必须走 POI 搜索 + 按 id 取详情。

```
# 第一步：按线路名搜 POI
GET https://restapi.amap.com/v3/assistant/inputtips
  ?keywords=汉奇K6路&city=武汉&citylimit=true&datatype=busline&key=...

# 第二步：按 POI id 取完整线路
GET https://restapi.amap.com/v3/bus/lineid
  ?id=<POI_id>&city=武汉&extensions=all&key=...
```

`inputtips` 返回 `tips[]`，每项含 `id`（POI id）和 `name`（线路全名）。
过滤出 `/汉奇/` 开头的 POI，再逐个调 `lineid` 取详情。
`lineid` 返回的 `buslines[0]` 结构与 `linename` 一致（含 `polyline` / `busstops`）。

> ⚠ `inputtips` 是模糊搜索，对集团纯数字线路号覆盖率低（常返回 `408路` / `轨道交通4号线`
> 等干扰项），因此**仅用于汉奇线路**，不用于集团线路的主采集。

#### C.2.4 兼容模式：`getPoiNewbus`（免 Web 服务 Key 站点接口）

> **定位**：与 C.2.2 / C.2.3 并列的**第三种获取模式**，不依赖高德 Web 服务 Key、不消耗 `restapi` 日配额，
> 适用于 Key 额度耗尽时的补充采集、以及需要额外字段（地铁换乘 / 包围盒 / 线路长度）的场景。
> ⚠ 但**必须携带网页会话 Cookie**（实测未带会 302 跳首页），详见 C.2.4.1。

```
GET https://www.amap.com/ssr/api/getPoiNewbus
  ?id=900000128833          # 线路 POI id（与 linename 返回的 id 同源）
  &keywords=337路           # 线路名关键词（可选，仅用于辅助定位）
  &city=420100              # 城市数字编码（非城市名）
```

| 参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `id` | ✅ | 线路 POI id，如 `900000128833`（与 `linename` / `lineid` 返回的 `id` 一致） |
| `keywords` | ❌ | 线路名关键词，如 `337路`；仅辅助定位，实际以 `id` 为准 |
| `city` | ✅ | 城市数字编码，武汉 = `420100`（与 `linename` 的城市名参数不同） |

**鉴权 / 必填请求头**（实测结论，详见 C.2.4.1）：

| 头 | 必填 | 说明 |
| ---- | ---- | ---- |
| `Cookie` | ✅ | 从浏览器 DevTools 复制 `www.amap.com` 的完整 Cookie 串（关键项：`isg`、`diu`、`x-csrf-token`、`cna`）。**未带或失效 → 302 跳回 `https://www.amap.com/`**，不是 401，极易被误判成「接口挂了」 |
| `User-Agent` | ✅ | 浏览器 UA，否则被 WAF 拦 |
| `Referer` | ✅ | `https://www.amap.com/ssr/search/busline_detail?...&busId=<id>&keywords=<线路名>&key_name=<线路名>` |
| `x-csrf-token` | 建议 | 由 Cookie 里的 `x-csrf-token` 值 `decodeURIComponent` 得到（如 `...%3Ana62` → `...:na62`） |
| `x-adiu` | 建议 | 等于 Cookie 里的 `diu` |
| `bx-v` / `sec-fetch-*` | 可选 | 网页前端指纹，带上更贴近真实请求 |

- **不需要**高德 Web 服务 Key，也不消耗 `restapi.amap.com` 的日配额；
- **但**需要网页会话 Cookie，Cookie 会过期（尤其 `isg`），失效后重新抓一份即可；
- Cookie 属会话凭证，只放本地环境变量 `AMAP_WEB_COOKIE`，**不进仓库/前端**；
- 本机若需代理，设 `NODE_USE_ENV_PROXY=1`（Node 24+ 让 `fetch` 读 `HTTPS_PROXY`），否则直连 `www.amap.com` 会 `UND_ERR_CONNECT_TIMEOUT`。

**响应结构**（`data.busline_list[0]`）：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `name` | String | 线路全名，如 `337路(汉城路公交停车场--汉新大道公交停车场)` |
| `key_name` | String | 线路简称，如 `337路` |
| `front_name` | String | 起点站名 |
| `terminal_name` | String | 终点站名 |
| `company` | String | ★ 营运公司全称（如 `武汉公交集团第四客运分公司`），比 `linename` 的 `company` 字段更详细 |
| `start_time` | String | 首班车 `HHmm` |
| `end_time` | String | 末班车 `HHmm` |
| `basic_price` | String | 票价 |
| `length` | String | ★ 线路长度（km），如 `13.096000` |
| `bounds` | String | ★ 包围盒 `"lng,lat;lng,lat"`，如 `114.189405;30.505809;114.254116;30.53625` |
| `xs` | String | ★ 走向经度串，逗号分隔，如 `114.202292,114.203016,...` |
| `ys` | String | ★ 走向纬度串，逗号分隔，如 `30.53625,30.536202,...` |
| `stations` | Array | ★ 站点列表（比 `linename` 的 `busstops` 更丰富） |
| `stations[].station_num` | String | 站序（从 1 起） |
| `stations[].name` | String | 站名 |
| `stations[].xy_coords` | String | ★ 站点坐标 `"lng,lat"`（分号分隔，注意与 polyline 的逗号不同） |
| `stations[].station_id` | String | 站点 POI id |
| `stations[].poiid2` | String | 高德 POI id（`BV...`，与 `linename` 的 `busstops[].id` 同源） |
| `stations[].subways` | Array | ★ 地铁换乘信息（`linename` 不返回此字段） |
| `stations[].subways[].line_key` | String | 地铁线路名，如 `12号线`、`3号线` |
| `stations[].subways[].status` | String | 换乘状态：`1`=可换乘，`3`=在建 |
| `stations[].subways[].color` | String | 线路色值 |

**与 `linename` / `lineid` 的关键差异**：

| 维度 | `linename` / `lineid` | `getPoiNewbus` |
| ---- | ---- | ---- |
| 域名 | `restapi.amap.com` | `www.amap.com` |
| 鉴权 | 需要 API Key + 可选签名 | 免 Web 服务 Key，但**必须带网页会话 Cookie** |
| 城市参数 | 城市名 `武汉` | 数字编码 `420100` |
| 走向数据 | `polyline` 字符串 `"lng,lat;..."` | `xs` / `ys` 分离数组 |
| 站点坐标 | `busstops[].location` = `"lng,lat"` | `stations[].xy_coords` = `"lng,lat"`（分号分隔） |
| 地铁换乘 | ❌ 不返回 | ✅ `stations[].subways[]` |
| 线路长度 | ❌ 不返回 | ✅ `length` |
| 包围盒 | ❌ 不返回 | ✅ `bounds` |
| 公司名 | 简写 | ✅ 全称 |

**使用场景**：

1. **Key 额度耗尽时的补充采集** — 免 Web 服务 Key，与 `linename` 配额池完全独立，日配额耗尽后仍可继续采集（前提是 Cookie 有效）。
2. **快速验证** — 无需申请 Key、无需签名；但需从浏览器 DevTools 复制一份 Cookie 设到 `AMAP_WEB_COOKIE`。
3. **丰富资产字段** — 需要地铁换乘信息、线路长度、包围盒时使用（当前 `linename` 链路不返回这些）。
4. **非集团线路（蔡城 / 木兰 / 汉奇）** — 与 `inputtips → lineid` 链路并列，可作为第三条获取路径。

**注意事项**：

- ⚠ `www.amap.com/ssr/api/` 是高德网页前端的 **SSR 内部接口**，非官方 Web 服务 API，
  字段名与返回格式可能随高德网页改版而变更，无公开文档保障。
- ⚠ **Cookie 是硬性前置**：未带/失效一律 302 跳首页，返回 HTML 而非 JSON。
  采集器用 `redirect:'manual'` 显式识别，一旦 302 立即中止全量并提示重抓，避免空跑。
- ⚠ 坐标系同样为 **GCJ-02**，落盘无需转换。
- ⚠ `id` 参数与 `linename` / `lineid` 返回的 `id` 同源（均为 `900000128833` 格式），
  可先走 `linename` 拿到 `id`，再用 `getPoiNewbus` 补充字段。
- ✅ 与现有 `linename` / `inputtips → lineid` 链路**完全兼容**、并行存在，
  但**不自动切换**：兼容模式是独立的 `npm run scan:poi-newbus`，由开发者按需手动跑
  （只补字段、默认不覆盖已有走向），主链路的 `10044` 自动降级逻辑保持不变。

#### C.2.4.1 实测两例对照（337路 / 681路）

已抓到两条真实请求，结构**完全一致**：仅 `id`、`keywords` 随线路变化，`city` 恒为 `420100`，
其余 URL 形态、返回结构一律相同，证明该接口是按 `id` 取单条线路、与线路号无关的通用接口。

**337路（只贴了 URL，未贴请求头）**
```
GET https://www.amap.com/ssr/api/getPoiNewbus
  ?id=900000128833&keywords=337%E8%B7%AF&city=420100
```
响应头 `HTTP/2 200`、`ups-target-key: amap-pc-ssr.vs.amap.com` / `ditu.vs.amap.com`，
`data.busline_list[0]` = `337路`，29 站、`xs`/`ys` 各 263 点、`length=13.096000`、8 个站点带 `subways`。

**681路（浏览器完整 curl，把请求头也一并贴出）**
```
GET https://www.amap.com/ssr/api/getPoiNewbus
  ?id=900000162531&keywords=681%E8%B7%AF&city=420100
  -H 'x-csrf-token: 7e2a88c19203d67b35e8809aec175223:na62'
  -H 'x-adiu: ssraeea79bcb3efbb49d5b8e3cbbb109132'
  -H 'bx-v: 2.5.37'
  -H 'sec-fetch-site: same-origin' / 'sec-fetch-mode: cors' / 'sec-fetch-dest: empty'
  -H 'cookie: ...x-csrf-token=7e2a88c19203d67b35e8809aec175223%3Ana62; isg=...; diu=...; passport_login=...'
  -H 'referer: https://www.amap.com/ssr/search/busline_detail?...&busId=900000162531&keywords=681%E8%B7%AF&key_name=681%E8%B7%AF'
```

| 维度 | 337路 | 681路 | 结论 |
| ---- | ---- | ---- | ---- |
| 端点 | `www.amap.com/ssr/api/getPoiNewbus` | 同左 | 完全一致 |
| `id` | `900000128833` | `900000162531` | 每条线不同（= 线路 POI id，命名空间同 `linename` 的 `id`）；681 的 `referer.busId` 与之相同 |
| `keywords` | `337路` | `681路` | 仅辅助定位，实际按 `id` 解析；`referer.key_name` 同值 |
| `city` | `420100` | `420100` | 恒定（武汉数字编码） |
| 会话头（csrf/cookie/referer） | 抓包时未贴出 | 完整贴出 | **两例浏览器都会带**；337 只是省略了头，不代表不需要 |
| 返回 schema | `data.busline_list[0]` | 同左 | 完全一致，接口与线路号无关 |

**关键判断（已用实测验证，推翻「裸 GET 免鉴权」的初判）**：

| 请求 | 结果 |
| ---- | ---- |
| 裸 GET（无任何自定义头） | `302 Found`，`Location: https://www.amap.com/`（Tengine 跳首页） |
| 带 `User-Agent` + `Accept` + `Referer`，**不带 Cookie** | 仍然 `302`，跳回首页 |
| 带上述头 + **完整会话 Cookie**（含 `isg` / `diu` / `x-csrf-token`） | `200`，返回完整 JSON（337路：29 站 / 263 个走向点 / 8 个换乘站） |

- 因此 **Cookie 是硬性必填**，不是「浏览器会话残留」；`x-csrf-token`（header）由 Cookie 里的
  同名值 `decodeURIComponent` 得到，`x-adiu` = Cookie 里的 `diu`，三者同源、必须配套。
- 681路 的 `referer` 把 `busId` / `keywords` / `key_name` 原样回带，属网页前端上下文；
  采集器照样按此格式构造，以贴近真实请求。
- 失效表现是 **302 而非 401**：采集器用 `redirect:'manual'` 显式识别，一旦 302
  立即中止全量并提示重抓 Cookie，避免把 HTML 当成「接口无数据」白跑一遍。
- 本机直连 `www.amap.com` 会 `UND_ERR_CONNECT_TIMEOUT`；走 `HTTPS_PROXY` 时，
  Node 24+ 需设 `NODE_USE_ENV_PROXY=1`（或 `curl -x`），`curl` 默认读环境变量代理。

> 结论：该模式的准确定位是「**免高德 Web 服务 Key，但需网页会话 Cookie**」，
> 而不是「无需任何鉴权」。Cookie 只放本地 `AMAP_WEB_COOKIE` 环境变量，不进仓库。

### C.3 采集链路与产物

#### C.3.0 采集模式总览（三条高德链路 + 一条兜底）

| 模式 | 采集器 | 适用线路 | 鉴权 | 优先级 |
| ---- | ---- | ---- | ---- | ---- |
| **主链路** | `scan-routes-amap.mjs` | 集团数字线（337/909/273…） | API Key | A（更优） |
| **备用链路** | `scan-foreign.mjs` | 蔡城 C / 木兰 P / 汉奇 | API Key | A'（汉奇专用） |
| **兼容模式** | `scan-poi-newbus.mjs` | 全部线路（补充地铁换乘等字段） | 免 Web 服务 Key / 需网页会话 Cookie | A'（补充） |
| **id 回填** | `scan-amap-ids.mjs` | 历史 `amap` 资产缺 `amap.id` 时补一次 | API Key（`inputtips` 独立池）+ 可选 Cookie | 前置步骤 |
| **兜底** | `scan-routes.mjs` | 高德未收录线（D/K 定制） | 免 Key（OSRM） | B |

#### C.3.0.1 历史资产缺 `amap.id`：用 `inputtips` 批量回填

兼容模式按 `id` 取数，而**早期主链路没落 `amap.id`**（2026-11-12 回填前：
四类分片共 3536 个方向，其中 1106 个 `source:'amap'` 方向全都没有 id）。
两个主采集器现已补上该字段，但历史资产要回填一次，`scan-poi-newbus.mjs` 才能全量跑。

**id 来源**：`/v3/assistant/inputtips?datatype=busline` 按线路名**精确匹配**，
返回的 `tips[].id` 就是 `getPoiNewbus` 需要的线路 POI id：

```
GET https://restapi.amap.com/v3/assistant/inputtips
  ?keywords=337路&city=武汉&citylimit=true&datatype=busline&key=<Key>
→ tips: [{ id:"900000128833", name:"337路" }, { id:"900000128492", name:"337路" }]
```

- ✅ 与抓包完全一致（337 → `900000128833`，681 → `900000162531`），
  实测对 451 条 `amap` 线路抽样 30 条，**命中率 100%**，通常每线 2 个 id（双向）。
- ✅ **配额池独立于 `linename`**：`linename` 报 `10044` 时 `inputtips` 仍可用。
- ✅ id 有两种格式（`900000...` / `420100...`），实测**都能喂给 `getPoiNewbus`**。
- ⚠ 必须按 `name` 精确匹配过滤（`1路` 会混入 `C1路` / `J1路`，`306路` 会混入 `Y306路` / `J306路`）；
  D/K 定制线与部分停运线高德本就不收录（`MISS` 正常，它们走 OSRM 兜底，不需要 id）。
- ❌ 免 Key 拿 id 的路子均不通：`getPoiNewbus` 不带 id 直接报
  `{"code":0,"message":"公交线路ID不能为空"}`；`service/poiInfo` 被风控
  `FAIL_SYS_USER_VALIDATE` 拦截；SSR 搜索页 HTML 不内嵌线路 id（结果客户端异步加载）。

**双向定向**：`inputtips` 的 tip 只有 `id` + `name`，没有起讫站。用 `getPoiNewbus`
返回的 `front_name` / `terminal_name` 与资产 `base.startStop` / `endStop` 比对给上下行定向；
响应的 `direc` 字段就是**对向 id**，起讫站互换即可构造对向信息，省一次请求。
实测 337 的 `direc=900000128492` 正是下行。定向按吻合度贪心互斥分配，保证两个方向拿到不同 id。

```powershell
$env:AMAP_KEY="你的高德Web服务Key"
$env:AMAP_WEB_COOKIE="..."        # 默认模式需 Cookie 定向
$env:NODE_USE_ENV_PROXY="1"       # 本机需代理时

node scripts/scan-amap-ids.mjs --only 337,681,243 --dry   # 小样本先验证
npm run scan:amap-ids                                      # 全量回填（只补 amap.id）
node scripts/scan-amap-ids.mjs --no-verify                 # 不调网页接口，按 dirs 顺序粗分配
```

只补强不降级：已有 `amap.id` 的方向跳过（`--force` 才重写），
**绝不改 `route` / `stops` / `source`**；每 25 条落盘一次，可 `--only` / `--limit` 分批跑。
网络瞬断会重试 3 次，仍失败则记「未判定」不写盘、下轮自动续采，不会误记成「高德未收录」。

**回填结果（2026-11-12 实测）**：全库 1106 个 `source:'amap'` 方向，
回填 **1077 个（97.4%）**，唯一 id 覆盖集团 `bNN` + 非集团 `CCB/MLB/HQB` 全部四类分片，
两种 id 格式（`900000...` / `420100...`）混合。剩余 29 个方向 / 16 条线是
D 定制线与少数 P 线（`P128` / `P83` 等），`inputtips` 确认无精确匹配，属高德未收录，
保持原样即可（它们不影响兼容模式跑其它线路）。
之后 `npm run scan:poi-newbus` 即可全量补充字段，不再缺 id。

#### C.3.0.2 原理：为什么能批量拿到 id（推导链全记录）

看起来「凭两条抓包 URL 就补全了全库 1077 个 id」有点神奇，其实没有黑魔法，
**关键是发现两个不同域名的高德接口共用同一套线路 POI id**，于是「免 Key 取数」
被拆成了「用官方接口查 id」+「用网页接口按 id 取数」两步。完整推导链如下，
每一步都有实测依据，便于日后接口变动时按同样方法重新定位。

**第 1 步：从抓包里读出接口的真实入参**

对比 C.2.4.1 的 337路 / 681路 两条请求，只有 `id` 与 `keywords` 变化，
且 681 的 `referer.busId` 与 query 的 `id` 同值 → `id` 是线路主键，
`keywords` 只是辅助定位。结论：**要调这个接口，必须先有线路 POI id**。

**第 2 步：验证 id 的「跨域通用性」（这是整件事的支点）**

| 验证动作 | 结果 |
| ---- | ---- |
| `inputtips?keywords=337路&datatype=busline` | 返回 `900000128833` / `900000128492`，与浏览器抓包的 337 id **完全一致** |
| `inputtips?keywords=681路` | 返回 `900000162531`，与浏览器抓包的 681 id **完全一致** |
| `lineid?id=900000128833` | 返回该线路完整 `buslines[0]`，`id` 原样回显 |
| `getPoiNewbus?id=900000162531` | 返回 681路 完整站点/走向 |
| `getPoiNewbus?id=420100014299`（909路，另一种格式） | 同样返回 200 完整数据 |

→ `restapi.amap.com`（官方 Web 服务）与 `www.amap.com`（网页 SSR）**共用同一套线路 POI id
命名空间**，且 id 有两种格式 `900000...` / `420100...` 都通用。
因此：**官方接口查到的 id 可以直接喂给网页接口**，这是整条链路能成立的根本原因。

**第 3 步：找「线路号 → id」的批量映射来源**

`id` 是内部编号（无规律、不可由线路号推算），只能查表。逐一实测了四条路：

| 候选 | 结果 | 结论 |
| ---- | ---- | ---- |
| `getPoiNewbus` 不带 id | `{"code":0,"message":"公交线路ID不能为空"}` | ❌ 不能自举 |
| `service/poiInfo` 按名搜 | `FAIL_SYS_USER_VALIDATE`（风控验证码） | ❌ 不可用 |
| SSR 搜索页 HTML | 200 但无 `900000...`，结果由客户端异步加载 | ❌ 不内嵌 id |
| **`/v3/assistant/inputtips?datatype=busline`** | 返回 `tips[].id`，即第 2 步验证过的同一 id | ✅ **可用** |

并且 `inputtips` 与 `linename` **日配额池独立**：本次实操时 `linename` 已报 `10044`
耗尽，而 `inputtips` 仍正常返回 —— 所以即便主链路跑不动，id 回填照样能完成。

**第 4 步：解决「一条线多个 id 对应哪个方向」**

`inputtips` 的 tip 只有 `id` + `name`，没有起讫站。但 `getPoiNewbus` 响应里带了三样东西：
`front_name`（起点）、`terminal_name`（终点）、`direc`（**对向线路的 id**）。
于是：

1. 用 `front_name`/`terminal_name` 与资产 `base.startStop`/`endStop` 比对，给上下行定向；
2. `direc` 直接构造「起讫站互换」的对向信息，**省掉第二次请求**；
3. 按吻合度贪心互斥分配，保证 dir0 / dir1 拿到不同 id。

实测 337：`900000128833` 的响应 `direc=900000128492`，正是下行；909 的两种格式同理。

**第 5 步：只补字段，不碰已有资产**

回填脚本只写 `row.amap.id`，绝不改 `route` / `stops` / `source` / `base`。
全库 86 个分片、1768 个方向与 `git HEAD` 逐一比对，**0 异常**。
这一步是「只补强不降级」原则的落地，也是能放心全量跑、随时中断重跑的前提。

**第 6 步：Cookie 是隐藏前置（最容易踩的坑）**

网页接口不是真「免鉴权」：不带 Cookie 一律 `302` 跳首页（**不是 401**），
带会话 Cookie 才 200。所以采集器用 `redirect:'manual'` 显式识别 302 并立即中止，
避免把 HTML 当成「接口无数据」空跑全量。详见 C.2.4.1。

> 一句话总结：**id 是跨接口通用主键 → 用 `inputtips`（独立配额池）批量查表 →
> 落到 `amap.id` → `getPoiNewbus` 按 id 补字段**。
> 没有任何私有数据或非公开破解，只是把两个官方/网页接口用公共主键串了起来。

#### C.3.1 集团线路：`scan-routes-amap.mjs`

```
npm run scan:routes:amap            # 全量采集
node scripts/scan-routes-amap.mjs --only 337,909,273   # 小样本验证
node scripts/scan-routes-amap.mjs --retry-unmatched   # 只重试未命中线
```

**流程**：
1. 读 `src/static/lines/lines.json`（线路库），逐条线按线路号调高德
2. 高德返回 `buslines` 数组（一条线可能有多个方向）
3. 用**清洗后的首末站名**匹配高德方向（`matchBusline()`）：
   - 先按正序匹配（起点→终点）
   - 匹配不上再按反序匹配（高德常只给一条 polyline，两个方向共用）
4. 解析 `polyline` → 点列 → Douglas-Peucker 抽稀（容差 0.00001° ≈ 1.1m）
5. 落盘到 `src/static/lines/bNN.json`（64 个哈希分片），写入：
   - `source: 'amap'`、`snapped: true`、`algo: 100`
   - `route`: 展平 `[lng,lat,...]` 数组
   - `stops`: 精简站点（保留 `stopNo` / `stopId` / `stopName` / `longitude` / `latitude` / `transferInfos`）

**断点续跑**：`scripts/.amap-progress.json` 记录每条线的采集状态
（`done` / `partial` / `no-match` / `not-found`），已记录的线直接跳过。

#### C.3.2 非集团线路：`scan-foreign.mjs`

```
npm run scan:foreign              # 全量（C/P + 汉奇）
node scripts/scan-foreign.mjs --hanqi-only     # 只跑汉奇
node scripts/scan-foreign.mjs --only C1,P2     # 只采指定号
```

**C/P 链路**（蔡城 C、木兰 P）：按号段枚举关键词 `C1`~`C20`、`P1`~`P130`，
调 `/v3/bus/linename`，用 `parseNo()` 解析线路号（正则 `/^([A-Za-z]+\d+)(快|区间|夜行)?路?/`）。

**汉奇链路**：用 `hanqiKeywords()` 生成关键词列表（含宽泛词 `汉奇`、
`汉奇公交` 等 + 已知种子线路名 + `--hanqi-deep` 深度枚举），
调 `inputtips` → 过滤 `/汉奇/` → `lineid` 取详情。

**产物**：
1. `src/static/lines/foreign-lines.json` — 线路库摘要（供 `lineIndex.js` 合并进检索池）
2. `src/static/lines/CCB01.json` / `MLB01.json` / `HQB01.json` … — 资产分片
   （命名规则：公司缩写 + `B` + 两位桶号，由 `foreignShardOf()` 定位）

**站点 stopId 改写**：高德原 ID 为 `BV...`，落盘改写为 `${abbr}B${序号}`
（如 `CCB0001`），原值存 `originId` 备查。

**运行时加载**：`utils/lineAsset.js` 的 `loadLineAsset(no)` 按需 HTTP 拉取分片，
内存缓存 + Promise 去重，不进 bundle / localStorage。

#### C.3.3 兼容模式：`scan-poi-newbus.mjs`（免 Web 服务 Key / 需会话 Cookie）

```powershell
# 1) 从浏览器 DevTools 复制 www.amap.com 的完整 Cookie（不进仓库）
$env:AMAP_WEB_COOKIE = "amap_new_version_flag=1; ...; isg=..."
$env:NODE_USE_ENV_PROXY = "1"          # 本机需代理时（Node 24+ 让 fetch 读 HTTPS_PROXY）

npm run scan:poi-newbus                             # 全量（无需 AMAP_KEY）
node scripts/scan-poi-newbus.mjs --only 337,909,273 # 小样本先验证 Cookie 是否有效
node scripts/scan-poi-newbus.mjs --overwrite         # 用 newbus 的 xs/ys 覆盖 route/stops
node scripts/scan-poi-newbus.mjs --dry               # 只统计、不落盘

# 历史资产还没重跑主链路（无 amap.id）时，可直接指定 POI id 试跑，脚本会顺手回填 amap.id
node scripts/scan-poi-newbus.mjs --ids 337:0:900000128833,681:0:900000162531 --only 337,681 --dry
#                                     线路号:方向:POIid（方向省略默认 0）
```

**前置 1 — 会话 Cookie**：`AMAP_WEB_COOKIE` 必填，脚本缺失时直接退出（exit 2）并给出指引。
Cookie 里的 `x-csrf-token` / `diu` 自动派生为同名请求头。**不需要** `AMAP_KEY`。
**前置 2 — `amap.id` 资产**：`scan-routes-amap.mjs` / `scan-foreign.mjs` 现已把线路 POI id
落到 `row.amap.id`（来自 `linename` / `lineid` 响应 `buslines[].id`，命名空间与
`getPoiNewbus` 的 `id` 完全一致）。**但历史资产没有该字段**，需先跑一次
`npm run scan:amap-ids` 回填（见 C.3.0.1），或用 `--ids` 手工指定少量线试跑。
本采集器读回 id 逐线补充字段；一个方向都没有 id 时会报错退出并提示上述前置步骤。

**流程**：
1. 扫描 `src/static/lines/` 的全部分片（集团 `bNN.json`（64 桶哈希） +
   非集团 `CCB/MLB/HQB` 前缀 + 两位桶号，如 `CCB01.json`；排除 `manifest.json`），
   收集带 `amap.id` 的方向；`--ids` 指定的映射优先级次之、并会回填进资产
   （每个方向一个 id：`getPoiNewbus` 按 id 返回**单个方向**，与 `linename` 的
   「一个 busline = 一个方向」一一对应）
2. 调 `https://www.amap.com/ssr/api/getPoiNewbus?id=<amap.id>&keywords=<线路名>&city=420100`
   （带 Cookie / User-Agent / 构造的 `Referer` / `x-csrf-token` / `x-adiu`；
   `keywords` 按 `<线路号>路` 兜底拼装，仅辅助定位；`redirect:'manual'` 识别 302）
3. 从 `data.busline_list[0]` 提取：
   - 走向：`xs`（经度串）+ `ys`（纬度串）→ 交叉配对为 `[lng,lat,...]` 展平点列
   - 站点：`stations[].xy_coords`（分号分隔的 `"lng,lat"`）→ 按 `station_num` 对齐站序
   - 附加字段：`subways`（地铁换乘）、`length`（线路长度）、`bounds`（包围盒）、
     `company`（公司全称）
4. 回写同一分片（**只补强不降级**，绝不删已有 `route` / `stops`）：
   - `stops[].transferInfos`：由 `stations[].subways` 映射，
     ⚠ **必须写成 `{ subwayLineNo: '12' }`**——前端 `LineStops.vue` 读 `t.subwayLineNo` 拼「号线」，
     `line_key` 形如 `12号线` / `(在建)11号线四期`，只取数字部分；在建额外标 `building:true`，
     色值放 `color`。写成 `{line,status,color}` 会导致换乘标签空白。
     **按站名归一匹配优先**、匹配不到才退回 `station_num`（两数据源站序可能不同，绝不硬按序号塞），
     `linename` 链路不返回该字段，这是兼容模式的核心增量
   - `amap.newbus`：记 `{ id, keyName, company, length, bounds, subwayTotal, fetchedAt }`
   - 仅 `--overwrite` 时才用 newbus 的 `xs`/`ys` 覆盖 `route`、用 `stations[]` 覆盖 `stops`

**与 `linename` 链路的差异**：
- 免 Web 服务 Key，不消耗 `restapi.amap.com` 配额（配额池完全独立），但需网页会话 Cookie
- 站点带地铁换乘信息（`subways`）→ 补齐 `transferInfos`
- 走向由 `xs` / `ys` 分离数组交叉配对生成（而非 `polyline` 字符串直接解析）
- 城市参数用数字编码 `420100`（而非城市名 `武汉`）
- 依赖上一步落盘的 `amap.id`，无法独立枚举线路（`id` 只能来自 `linename` / `lineid`）

> ⚠ `www.amap.com/ssr/api/` 为高德网页 SSR 内部接口，无公开文档保障，
> 建议先小批量试跑（`--only`）验证 Cookie 有效性后再全量。
> ⚠ Cookie（尤其 `isg`）会过期，失效表现为 **302 跳首页**而非 401；脚本识别后立即中止全量，
> 重新从浏览器抓一份 Cookie 覆盖 `AMAP_WEB_COOKIE` 即可，未处理方向保留原资产、下轮自动重试。
> ⚠ 默认 `--delay 350`（免配额但仍是网页接口，别打太猛）；成片未响应优先调大间隔。

### C.4 走向几何的采集策略

项目共三条高德数据链路 + 一条 OSRM 兜底，按优先级与可用性动态选择：

| 优先级 | 来源 | 接口 | 说明 |
| ------ | ---- | ---- | ---- |
| **A（更优）** | 高德官方公交轨迹 | `/v3/bus/linename` | 公交公司上报的真实走向，沿固定线路、走专用道，不存在驾车路网绕街区问题 |
| **A'（兼容）** | 高德网页站点接口 | `getPoiNewbus` | 免 Web 服务 Key（需会话 Cookie），返回 `xs`/`ys` 走向 + 丰富站点字段（地铁换乘/长度/包围盒）；Key 额度耗尽或需要额外字段时使用 |
| **B（兜底）** | OSRM 驾车路网近似 | `router.project-osrm.org` | 免 Key，仅对高德未收录的线路（D/K 定制线等）使用 |

- `scan-routes-amap.mjs` **只写 `source:'amap'` 的行**，绝不删除 B 的结果。
- `scan-routes.mjs`（OSRM）**只算 `source:'amap'` 之外的方向，且永不覆盖 amap 行**。
- 运行时 `LineMap.loadAllStops()` / `LineStops.loadDirStops()` 经 `lineAsset.js` 懒加载，
  资产命中即不发 `/line`；`assetSnapped` 为真时连 OSRM 也不请求。
- `getPoiNewbus` 与 `linename` / `inputtips → lineid` 配额池完全独立，可作为补充采集通道
  （`scan-poi-newbus.mjs` 只补 `transferInfos` / `amap.newbus` 字段，默认不动已有 `route` / `stops`）。

### C.5 站点序列清洗（唯一真源：`utils/routeClean.js`）

无论高德还是 OSRM，落盘前都经过统一清洗（运行时与两个生成器共用同一份实现）：

| 步骤 | 规则 | 阈值 |
| ---- | ---- | ---- |
| 1 | 过滤 `0/0` / 越界坐标 | lat∈[24,54], lng∈[73,135] |
| 2 | 按 `stopNo` 排序 | 仅在确有逆序时才排，避免误改环线 |
| 3 | 相邻重合去重 | < 5m |
| 4 | 整段坐标重复剔除 | 正序、相隔 ≥5 站、连续 ≥3 点重合（修 909 路型「同一段路两套站名塞两遍」） |
| 5 | 孤立离群点剔除（两轮） | 前后 > 3km 且 A→C 远小于 A→B/B→C |
| 6 | 折返簇剔除 | 瞬跳 > 5km 后 6 站内回到起点 2km 内 |
| 7 | 首/末端孤立错点 | 端点跳 > 15km 且与序列不相邻 |

回归测试：`npm run test:routeclean`（离线读 `network.json`，不发请求/不写文件）。

### C.6 后续线路更新操作指南

#### C.6.1 前置条件

- 高德 Web 服务 Key（[控制台申请](https://console.amap.com/dev/key/app)），
  类型选「Web 端」。Key 仅本地采集用，**不入库、不进前端代码**。
- 若 Key 开启签名校验，同时获取安全密钥（`AMAP_SECRET`）。

#### C.6.2 更新集团线路走向（高德官方轨迹）

```powershell
# 方案 A：全量补采（额度充足时）
$env:AMAP_KEY="你的Key"
npm run scan:routes:amap            # 全量，按免费额度限速（--delay 1100）

# 方案 B（省额度）：只补路网缺失的问题线
npm run scan:manifest               # 刷新 manifest，筛出 source=osrm 且 chord 多的线
node scripts/scan-routes-amap.mjs --only <问题线号列表>
```

采集器自带断点续跑：已是 `source:'amap'` 的行自动跳过，`--retry-unmatched`
只重试未命中线。日配额耗尽（`10044`）时自动切备用链路 `inputtips → lineid`；
如需不消耗 Key 额度地补充地铁换乘等字段，另跑兼容模式 `npm run scan:poi-newbus`
（需 `AMAP_WEB_COOKIE`，见 C.2.4 / C.3.3）。

#### C.6.3 更新非集团线路（蔡城 / 木兰 / 汉奇）

```powershell
$env:AMAP_KEY="你的Key"
npm run scan:foreign                 # 全量（C/P + 汉奇）
node scripts/scan-foreign.mjs --hanqi-only     # 只跑汉奇（linename 配额耗尽时用）
node scripts/scan-foreign.mjs --hanqi-deep     # 汉奇深度枚举（发现更多漏线）
node scripts/scan-foreign.mjs --only C1,P2     # 只采指定号
```

采集器「只补强不降级」：每次先读回已有摘要与分片再合并，本次未命中的线路不会被删。

跑完后生成全市线网补充底图：
```bash
npm run build:foreign-net
```

#### C.6.4 仅更新站点（不重算走向）

```bash
npm run scan:routes:stops           # 只拉站点→清洗→落盘（不调 OSRM，快）
```

#### C.6.5 刷新 manifest 索引

每次采集完（无论 amap 还是 foreign）后执行：
```bash
npm run scan:manifest               # 刷新 src/static/lines/manifest.json
```

#### C.6.6 常见问题

| 问题 | 原因 | 解决 |
| ---- | ---- | ---- |
| `infocode=10044` | 日配额耗尽 | 等待 0:00（北京时间）重置；或 `--hanqi-only` 只跑汉奇（配额池独立）；或跑兼容模式 `scan:poi-newbus`（不占 Key 配额，见 C.2.4） |
| `getPoiNewbus` 返回 302 | 会话 Cookie 缺失/过期 | 重新从浏览器 DevTools 复制 `www.amap.com` 完整 Cookie 到 `AMAP_WEB_COOKIE`；注意是 302 不是 401 |
| `infocode=10003` | QPS 限流 | 采集器自动退避重试；可调大 `--delay` |
| 汉奇线路查不到 | 关键词格式错误 | 必须用中文前缀全名（`汉奇K6路`），不能用 `汉奇1` |
| 集团线路高德未收录 | D/K 定制线 | 正常现象，保留 OSRM 兜底（B），无需处理 |
| 走向画成巨大矩形 | 上游站点坐标错误 | 已由 `routeClean.js` 清洗规则覆盖；如仍有问题先跑 `npm run test:routeclean` |
| `getPoiNewbus` 返回字段变了 | 高德网页改版 | SSR 内部接口无公开文档保障；字段名变更时需人工核对 C.2.4 字段表并更新解析逻辑 |
| `scan:amap-ids` 报「没有可用的线路 POI id」 | 资产分片里没有 `source:'amap'` 行 | 先跑 `scan:routes:amap` / `scan:foreign` 生成资产；或检查 `--out` 是否指错目录 |
| 回填后覆盖率没涨 | 名称变体 / 网络瞬断 | 名称变体已由资产全名兜底；瞬断记「未判定」不落盘，直接重跑本命令即可续采 |
| `scan:poi-newbus` 全部「未响应」 | Cookie 失效或网络未走代理 | 先加 `--only 337 --dry` 单线验证；302 会明确提示重抓 Cookie；本机需 `NODE_USE_ENV_PROXY=1` |

#### C.6.7 更新站点信息：完整复现流程（标准作业程序）

> 目标：**以后任何人照本节从头到尾执行一遍，就能把站点信息（地铁换乘、公司全称、
> 线路长度、包围盒，可选连同走向）刷新到最新**，不需要理解前面的推导。
> 原理见 C.3.0.2，字段表见 C.2.4，两个采集器细节见 C.3.0.1 / C.3.3。

##### 步骤 0 — 准备三个环境变量（PowerShell）

```powershell
# (a) 高德 Web 服务 Key：仅「回填 id」和重跑主链路时需要，控制台申请「Web服务」类型
$env:AMAP_KEY = "你的Key"

# (b) 网页会话 Cookie：兼容模式必填。抓法见下方「Cookie 怎么抓」
$env:AMAP_WEB_COOKIE = "amap_new_version_flag=1; ...; x-csrf-token=...; isg=..."

# (c) 本机走代理时必填（Node 24+ 才支持；否则直连 www.amap.com 会 UND_ERR_CONNECT_TIMEOUT）
$env:NODE_USE_ENV_PROXY = "1"     # 前提是 HTTPS_PROXY / HTTP_PROXY 已指向可用代理
```

**Cookie 怎么抓**（关键，会过期，每次开新会话前重抓一次最稳）：
1. Chrome 打开 `https://www.amap.com/`，搜索任意一条公交线路（如 `337路`），进入线路详情页；
2. F12 → Network → 筛选 `getPoiNewbus` → 点该请求 → Headers → Request Headers；
3. 复制整行 `cookie:` 的**值**（一长串，含 `isg` / `diu` / `x-csrf-token` / `cna`）；
4. 粘到 `AMAP_WEB_COOKIE`。**不要写进任何仓库文件**，只放环境变量。
5. 验证：`node scripts/scan-poi-newbus.mjs --only 337 --dry` 应输出「命中 1」；
   若提示 302，说明 Cookie 失效，回到第 1 步重抓。

> 环境变量只在当前 PowerShell 会话有效；换窗口要重设。
> `x-csrf-token` / `x-adiu` 请求头由脚本从 Cookie 自动派生，无需手填。

##### 步骤 1 — 确认 id 是否已齐（可跳过）

```powershell
node -e "const fs=require('fs'),p=require('path'),d='src/static/lines';let a=0,w=0;
for(const f of fs.readdirSync(d)){if(!/^(b\d+|CCB\d+|MLB\d+|HQB\d+)\.json$/.test(f))continue;
const j=JSON.parse(fs.readFileSync(p.join(d,f),'utf8'));
for(const l of Object.values(j.lines||{}))for(const r of Object.values(l.dirs||{})){if(r.source!=='amap')continue;a++;if(r.amap&&r.amap.id)w++}}
console.log('amap方向',a,'已带id',w,'覆盖率',(w/a*100).toFixed(1)+'%')"
```

- 覆盖率 ≈ 97% 以上 → **直接跳到步骤 3**（本次已回填完成）。
- 覆盖率明显偏低 / 新增了线路 → 执行步骤 2。

##### 步骤 2 — 回填线路 POI id（仅首次或新增线路时需要）

```powershell
node scripts/scan-amap-ids.mjs --only 337,681,243 --dry   # 先小样本验证（不落盘）
npm run scan:amap-ids                                      # 全量回填，可中断、可重跑
```

- 用 `inputtips`（与 `linename` 日配额池独立）按线路名精确匹配拿 id，
  用 `getPoiNewbus` 的起讫站 + `direc` 给上下行定向。
- **只写 `row.amap.id`**，不改 `route` / `stops` / `source` / `base`。
- 幂等：已有 id 的方向自动跳过；`--force` 才重写；网络瞬断记「未判定」不落盘，重跑续采。
- 预期输出：`命中线路 N，未收录 M，网络瞬断 0，回填 X 个方向`。
  少数 D 定制线 / P 线「未收录」是正常的（高德无此线，走 OSRM 兜底）。

##### 步骤 3 — 刷新站点信息（兼容模式，日常只需这一步）

```powershell
node scripts/scan-poi-newbus.mjs --only 337,909,273 --dry  # 先 dry 验证 Cookie 与返回
npm run scan:poi-newbus                                     # 全量补充（免 Web 服务 Key）
```

不带 `--overwrite` 时**只补强**：给缺换乘信息的站点加 `transferInfos`、
记 `amap.newbus`（公司全称 / 长度 / 包围盒 / 换乘站数 / 采集时间），
已有 `route` / `stops` 一律不动。

若确认要用高德 `xs`/`ys` 走向**替换**现有走向（会覆盖 `route` 与 `stops`，谨慎）：
```powershell
node scripts/scan-poi-newbus.mjs --only 337 --overwrite    # 先单线看效果
node scripts/scan-poi-newbus.mjs --overwrite                # 再全量
```

预期输出：`命中 N / M，未响应 0；补充地铁换乘 X 站`。
`未响应` 成片出现 → 多半 Cookie 限流/失效，调大 `--delay`（默认 350ms）或重抓 Cookie。

##### 步骤 4 — 验收（三步，别省）

```powershell
# (a) 资产健康自检：不依赖 git，任何分支/任何时刻都能跑；异常非 0 会 exit 1
node -e "const fs=require('fs'),d='src/static/lines';let dirs=0,amap=0,withId=0,badId=0,badTf=0,badCoord=0,badRoute=0;
for(const f of fs.readdirSync(d)){if(!/^(b\d+|CCB\d+|MLB\d+|HQB\d+)\.json$/.test(f))continue;
const j=JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));
for(const l of Object.values(j.lines||{}))for(const r of Object.values(l.dirs||{})){dirs++;
if(r.source!=='amap')continue;amap++;const id=r.amap&&r.amap.id;
if(id){withId++;if(!/^(900000|420100)\d+$/.test(String(id)))badId++}
for(const s of (r.stops||[])){if(!Number.isFinite(s.longitude)||!Number.isFinite(s.latitude))badCoord++;
for(const t of (s.transferInfos||[]))if(!t||!t.subwayLineNo)badTf++}
if(Array.isArray(r.route)&&r.route.some(x=>!Number.isFinite(x)))badRoute++}}
console.log('分片方向',dirs,'amap',amap,'带id',withId,'('+(withId/amap*100).toFixed(1)+'%)');
console.log('异常: 非法id',badId,'非法transferInfos',badTf,'非法坐标',badCoord,'非法route',badRoute);
if(!amap||badId||badTf||badCoord||badRoute)process.exit(1)"

# (b) 只补强校验（提交前跑，与 git HEAD 逐方向比对；⚠ 改动已提交后此步恒为 0，意义不大）
#     路径必须用正斜杠拼接，别用 path.join —— Windows 下会变成反斜杠导致 git show 全部失败，
#     而 catch{continue} 会静默吞掉失败，报出「校验方向 0 异常 0」的假通过。
node -e "const cp=require('child_process'),fs=require('fs'),d='src/static/lines';
const files=fs.readdirSync(d).filter(f=>/^(b\d+|CCB\d+|MLB\d+|HQB\d+)\.json$/.test(f));let n=0,bad=0,skipped=0;
for(const f of files){let o;try{o=JSON.parse(cp.execSync('git show HEAD:'+d+'/'+f,{encoding:'utf8',maxBuffer:60e6,stdio:['ignore','pipe','ignore']}))}catch(e){skipped++;continue}
const c=JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));
for(const [no,l] of Object.entries(o.lines||{})){const cl=c.lines[no];if(!cl){bad++;continue}
for(const [dd,r] of Object.entries(l.dirs||{})){const cr=cl.dirs&&cl.dirs[dd];if(!cr){bad++;continue}n++;
const a=JSON.parse(JSON.stringify(cr)),b=JSON.parse(JSON.stringify(r));const aa=a.amap||{},bb=b.amap||{};
delete a.amap;delete b.amap;if(JSON.stringify(a)!==JSON.stringify(b))bad++;
for(const [k,v] of Object.entries(bb))if(JSON.stringify(aa[k])!==JSON.stringify(v))bad++}}}
console.log('校验方向',n,'异常',bad,'无法读取',skipped);if(!n||bad||skipped)process.exit(1)"

# (c) 抽样看字段 + 前端冒烟
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('src/static/lines/b60.json','utf8'));
const r=j.lines['337'].dirs['0'];console.log('newbus=',JSON.stringify(r.amap.newbus));
console.log('换乘样例=',JSON.stringify(r.stops.filter(s=>s.transferInfos&&s.transferInfos.length).slice(0,2)))"
npm run dev:h5           # 打开 337 路，确认换乘标签显示「12号线」等、走向图不出现巨大矩形
npm run scan:manifest    # 最后刷新索引
```

验收判据：
- (a) 四个异常全为 0、覆盖率 ≈ 97%；`exit 1` 即为失败；
- (b) 「异常 0 / 无法读取 0 / 校验方向 > 0」，任一不满足说明脚本跑空或数据被改坏；
- (c) `transferInfos` 里是 `subwayLineNo` 而不是 `line`（写错会导致标签空白）；
  详情页换乘标签可见、走向图不出现巨大矩形。

> 2026-11-12 实测结果：`分片方向 1768 / amap 1106 / 带id 1077 (97.4%)`，
> 四项异常全 0；与 HEAD 比对 `校验方向 1768 / 异常 0`，确认只新增了 `amap.id`。

##### 步骤 5 — 变更范围速查表

| 想更新什么 | 跑哪条命令 | 需要 |
| ---- | ---- | ---- |
| 地铁换乘 / 公司全称 / 长度 / 包围盒 | `npm run scan:poi-newbus` | `AMAP_WEB_COOKIE` |
| 连走向一起换成高德 `xs`/`ys` | `npm run scan:poi-newbus -- --overwrite` | 同上（**会覆盖**，先单线试） |
| 站点名称/坐标（不重算走向） | `npm run scan:routes:stops` | 上游 `/line` |
| 官方 polyline 走向（A 源） | `npm run scan:routes:amap` | `AMAP_KEY` |
| 新增线路后补 POI id | `node scripts/scan-amap-ids.mjs --only <新线路号>` | `AMAP_KEY` + Cookie |
| 蔡城 / 木兰 / 汉奇 | `npm run scan:foreign` | `AMAP_KEY` |
| 只刷新索引 | `npm run scan:manifest` | — |

> 顺序铁律：**先 id 后数据**。没有 `amap.id` 时 `scan:poi-newbus` 会直接报错退出，
> 不会静默跳过；此时回到步骤 2，或用 `--ids 337:0:900000128833` 手工指定少量线试跑。
> 三个环境变量都只在本地会话内，不入库、不进前端。

### C.7 相关文件索引

| 文件 | 作用 |
| ---- | ---- |
| `scripts/scan-routes-amap.mjs` | 集团线路高德官方轨迹采集器（A） |
| `scripts/scan-routes.mjs` | 集团线路 OSRM 贴路采集器（B，兜底） |
| `scripts/scan-foreign.mjs` | 非集团线路（蔡城/木兰/汉奇）高德采集器 |
| `scripts/build-foreign-net.mjs` | 非集团线网底图生成器 |
| `scripts/_loadRouteClean.mjs` | 离线脚本载入 `routeClean.js` 的 data: URL 适配器 |
| `src/utils/routeClean.js` | 站点序列清洗 + 几何工具（唯一真源） |
| `src/utils/lineAsset.js` | 静态资产运行时懒加载 |
| `src/utils/companies.js` | 营运公司字典（唯一真源） |
| `src/utils/osrm.js` | OSRM 贴路（运行时，7 天缓存） |
| `src/static/lines/` | 资产分片目录（bNN.json + CCB/MLB/HQB） |
| `src/static/lines/foreign-lines.json` | 非集团线路库摘要 |
| `src/static/lines/manifest.json` | 资产索引（开发者用） |
| `scripts/.amap-progress.json` | 高德采集进度台账（不进仓库） |
| `scripts/scan-poi-newbus.mjs` | 兼容模式采集器（`getPoiNewbus`，免 Web 服务 Key / 需 `AMAP_WEB_COOKIE`，`npm run scan:poi-newbus`） |
| `scripts/scan-amap-ids.mjs` | 历史资产 `amap.id` 回填（`inputtips` 独立配额池，`npm run scan:amap-ids`） |
| — | **复现更新站点信息**：先读 C.3.0.2（原理），再照 C.6.7（标准作业程序 5 步）执行 |
