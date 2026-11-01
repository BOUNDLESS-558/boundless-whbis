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
