# AGENTS.md — 武汉公交信息实时查询（WuhanBus）

uni-app（Vue 3 + Vite 5）跨端应用：H5 网页版 + Android App，查询武汉公交线路、站点、时刻表、实时车辆。
**有 Git 仓库（main 分支，暂无远程）**，没有 CI / lint / typecheck，唯一可执行的验证手段是下面的两个 Node 测试。
提交前注意：`src/config.js` 的 openId 为占位值可入库；若将来填入真实密钥/Key，务必先加入 `.gitignore` 或改为环境注入。

## 命令（已实测可用）

```bash
npm run dev:h5       # 开发服务器 http://localhost:5173，自带 /api 跨域代理
npm run build:h5     # H5 产物 → dist/build/h5
npm run build:app    # App 资源 → dist/build/app（之后需 HBuilderX 云打包，无法纯 CLI 出包）
npm run test:md5     # MD5 实现单测（RFC 1321 向量 + 实测对照）
npm run test:busid   # 车辆编号还原测试（全量建字典约 400ms）
```

- 两个测试都是 `node scripts/*.mjs`，失败时退出码非 0，可直接当 CI 用。
- 运行时会出现 `MODULE_TYPELESS_PACKAGE_JSON` 警告（package.json 无 `"type": "module"`），**无害**，勿为此改 package.json——会破坏 uni-app 工具链。
- 改完 `src/utils/md5.js` 或 `src/utils/busId.js` 后务必跑这两个测试。

## 接口协议（最容易做错，三条铁律）

后端 `https://customized.wuhanbus.com/gps-resapi/wechat/bus`，完整文档见 `武汉公交信息实时查询API接口文档.md`（UTF-8）。

1. 必须 `POST + application/json`，GET 不支持。
2. **`openId` 必须放请求头**；放 query / body 一律返回 `90001 缺少openId`。其**值不被服务端校验**，`src/config.js` 里的任意非空字符串即可，不要花时间去找"真实 openId"。
3. `/line` 传 `lineCode`，`/detailPlanTime` 与 `/detailData` 传 `lineId`（用错参数名报 `3014`）。两者格式相同：`{cityCode}-{线路号}-{方向0|1}`，由 `config.js` 的 `buildLineCode()` 生成。

响应解包判据：`payload.success === true && payload.msg.code === '20000'`（见 `src/utils/api.js` 的 `post()`）。
后端怪癖：响应里的 `direction` 字段与请求方向**相反**，一律以请求时的编码 / `stopDetailList` 顺序为准。

## 架构要点（文件名看不出来的）

- 三个页面：`pages/index/index.vue`（搜索）→ `pages/line/line.vue`（详情，837 行，最复杂）→ `pages/map/map.vue`（地图）。页面间靠 **URL query 传参**（lineCode/direction/lineName/startStop/endStop），改跳转参数要同步改对端 `onLoad`。
- `utils/api.js` 用 uni-app 条件编译 `#ifdef H5` 切换 base：**H5 走 `/api` 前缀**（仅 dev 有 Vite 代理），App 直连真实域名。`build:h5` 产物没有代理，生产部署需 Nginx 反代并**显式透传 `openId` 自定义请求头**。
- `utils/busId.js`：接口的 `busId = MD5(自编号)`，通过枚举 0~200000 建反查字典。为不卡 UI 采用分片异步（每片 8000 + `setTimeout`），**字典就绪前 `decryptBusId()` 返回 null**，页面必须用 `onBusIdReady(cb)` 二次刷新。循环终止条件必须用 `end >= DICT_MAX`，改成 `n <= DICT_MAX` 会在 `n == DICT_MAX` 死循环。
- `utils/geo.js`：Haversine 距离 + 车辆匹配最近站点；详情页的"线路走向总览"按**沿线累计里程比例**定位站点，不是等距。
- 地图页双模式由 `src/config.js` 的 `mapKey` 决定：**留空（默认）走 SVG 线路示意图**，填高德 Key 才渲染原生 `<map>`。改地图相关代码要两种模式都验证。
- 详情页实时数据 `setInterval` 每 15 秒刷新，清理在 `onUnload`；新增异步任务时同样要在这里收尾。

## uni-app H5 渲染坑

- 横向滚动的 `scroll-view`：内容行会被默认 `display:flex` 压到容器宽，导致**内容被裁切而不是滚动**。本项目用 `display: inline-flex + min-width:100%`（见 `line.vue` 的 `.stop-row`）实现 shrink-to-fit，改站点卡片布局时别把这行删掉。
- 样式用 `rpx`，页面背景与主色 `#2B7A4B` 见 `pages.json` / 各页 `<style>`，无统一样式文件。

## 文档可信度

- **以代码为准**：`README.md` 里的项目路径写的是旧目录 `wuhanbus-app`（实际是本目录），目录树也漏了 `utils/busId.js`。
- 中文源文件均为 UTF-8；用 PowerShell `Get-Content` / `Select-String` 输出到控制台会乱码，读文件请用编辑器工具，别把乱码当成文件损坏。
