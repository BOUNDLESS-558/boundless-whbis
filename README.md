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
- **`pages`**：GitHub Pages 部署产物分支（孤立提交，由 `npm run deploy:pages` 自动维护），不用于开发。

工作流（按用户要求，三分支都推远端）：在 `main` 上提交改动 → 合并到 `BETA` → `git push origin main` 与 `git push origin BETA` → 需要发布网站时用 `npm run deploy:pages`（构建 + 强推 `origin/pages`）。远端 `origin/main`、`origin/BETA`、`origin/pages` 三个分支都保持存在并同步。

---

## 更新日志

### 2026-11-23（最新）

- **界面组件库切换（原生 / Bootstrap / Element Plus）**：`utils/settings.js` 新增 `UI_MODE_KEY`、`UI_MODE_OPTS`、`getUiMode()`/`setUiMode()`/`applyUiMode()`；「账号与设置 → 界面组件」分区提供三档分段控制（原生 / Bootstrap / Element Plus），原生为默认。H5 下切换时动态加载对应 CDN CSS（Bootstrap 5.3 / Element Plus 2.7），写 `<html data-ui-mode="…">` 让全局 CSS 据此覆盖。**两种现代模式均翻转为「浅色底 + 深色字」的库原生规范**（不再沿用深色玻璃拟态）：面板变白底 + 圆角 + 深阴影（Bootstrap 12px / Element 8px）、按钮按各自库规范重排（padding / 字重 / 边框 / hover / active）、分段控制改为库风格按钮组、输入框加聚焦阴影、分区标题改为卡片列表项、分割线 / 标签 / 值 / 提示文字全部反色对齐库调色板。App 端恒定原生（`getUiMode()` 对非 H5 直接返回 `'native'`）。启动时 `App.vue` 的 `onLaunch` 调 `applyUiMode()` 恢复上次选择。全局覆盖样式集中在 `App.vue` `<style>` 末尾，原生模式不命中、保持现有设计不变

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

### 2026-11-20

- **采集频率 6 小时 → 37 分钟**：`.github/workflows/daily-collect.yml` cron 改为 `*/37 * * * *`（GitHub 分钟按小时取模，实际每小时 00/37 分触发，平均约 30 分钟）
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
| `npm run deploy:pages` | 构建 H5 并推送到远端 `pages` 分支（GitHub Pages） | — |
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
│   ├── deploy-pages.mjs       # GitHub Pages 一键部署（孤立提交强推 pages 分支）
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

## 三、接口协议（★ 已破解，务必照做）

完整说明见仓库根目录 `武汉公交信息实时查询API接口文档.md`。

### 三条铁律

1. **必须 POST** + `Content-Type: application/json`（GET 不支持）
2. **openId 必须放在请求头**（header），放 query / body 一律返回 `90001 缺少openId`
3. **openId 的值服务端不校验**，任意非空 ASCII 字符串即可（`config.js` 里已填占位值，无需去找真实 openId）

### 请求样例

```http
POST https://customized.wuhanbus.com/gps-resapi/wechat/bus/line HTTP/1.1   （实际请求路径 /line）
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
| `POST /line` | `lineCode` | 线路基础信息 + 全部站点（含经纬度、地铁换乘） |
| `POST /detailPlanTime` | `lineId` | 计划发车时刻表 |
| `POST /detailData` | `lineId` | 在线运营车辆实时 GPS |

> ⚠️ 用错参数名会返回 `code:3014 lineCode:线路ID不能为空` / `lineId:线路id不能为空`。

### 线路编码规则

`{cityCode}-{线路号}-{方向}`，方向 `0` / `1` 表示上下行，例：`420100-337-0`。由 `config.js` 的 `buildLineCode()` 生成。
> 后端怪癖：响应里的 `direction` 字段与请求后缀**相反**，但 `stopDetailList` 的顺序与请求方向一致，以站点列表为准。

---

## 四、地图（`useNativeMap()` 唯一真值）

地图有两套渲染，判定只认 `src/config.js` 的 `useNativeMap()`（不拼接 Key、不出现多套判定变体）：

| 模式 | 触发条件 | 说明 |
| ---- | -------- | ---- |
| 原生地图 | App 端且 `APP_CONFIG.mapKey` 非空（Key 随安装包内置） | uni-app `<map>` 组件（高德底图 + 原生 marker/polyline） |
| 自绘走向图 | `useNativeMap()` 为假 | SVG 走向图：高德免 Key 瓦片底图 + 贴路走向 + 站点 + 实时车辆 |

判定规则：

- **App 端**：`APP_CONFIG.mapKey` 非空 → 原生地图（Key 来自 `src/manifest.json` 的 `app-plus.distribute.sdkConfigs.maps.amap.key`）。
- **H5 端**：`APP_CONFIG.mapKey` 留空（现状）→ `useNativeMap()` 恒为假 → 一律自绘走向图（免 Key 的 OSRM 贴路 + 高德免 Key 瓦片）。

> **自填高德 KEY 的用途与边界**：`config.js` 的 `mapKey` 留空（H5 现状），`useNativeMap()` 仍恒为假——自填 KEY **不会**把地图切成原生 `<map>`。它的作用是让**自绘走向图**通过 JS API 2.0 的 `AMap.LineSearch` 拉高德官方公交轨迹，替换 OSRM 贴路近似（`loadAmapJsApi` 动态注入 `webapi.amap.com/maps?v=2.0`，自绘模式没有原生 `<map>` 所以不会自动加载）。设置面板「账号与设置 → 高德地图 KEY」提供两个独立输入框：**Key（必须 Web端 JS API 类型，Web服务/REST Key 会报 `USERKEY_PLAT_NOMATCH` 不生效）** 与 **安全密钥（JS API 2.0 的 securityJsCode，选填）**；成对存 `whbis:amap-key`（`key,secret`，兼容旧格式）。换 KEY 会清掉旧 `window.AMap` 重新注入，LineSearch 失败弹明确提示且回退 OSRM。若将来需要 H5 原生地图，另填 `manifest.json` 里 H5 的 `sdkConfigs.maps.amap`（构建期注入后重启 dev）。

**自绘走向图的两个底座**（都不依赖高德 JS API）：

- **底图**：`.tile-layer` 用 `<image>` 拼高德标准瓦片（`webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=..&y=..&z=..`，免 Key、GCJ-02、256px），`zt=floor(zoom)` + `scale=2^(zoom-zt)` 定位，再叠 `.tile-shade` 暗蒙版降饱和，保证站名/车号可读。控制卡可关闭底图。
- **走向**：`utils/osrm.js` 调 OSRM（WGS-84，需与 GCJ-02 互转）吸附站点序列。
  - 逐段质检用**最大垂距**，不用「规划距离/直线距离」ratio——站前掉头 ratio 11 只偏 76m 却真实，吸到高架 ratio 17 已跑 3km 外。
  - 坏段四级修复：贴走廊直接用 → 加 1/3、2/3 途经点重算 → **换端点吸附候选**（`/nearest?number=3`）→ 站间短直线。坏段根因是站点被吸到高架层/对向车道。
  - 结果按 `{线路号}-{方向}` 缓存 7 天（键前缀 `whbis:osrm-route:v5:`，算法变更需升版本号）。OSRM 是公共 demo 服务，会限速/断连，全部失败仅回退站点连线（细虚线 + `routeAlert` 提示）。
- **线路静态资产优先**：`src/static/lines/**` 由生成器产出（集团 `bNN` 64 桶 + 非集团 `CCB`/`MLB`/`HQB` 分片），每条线路双方向含 `base`/`stops`/`route`/`snapped`/`source`（`amap` 高德官方轨迹更优，`osrm` 驾车近似兜底）。`LineMap` 懒加载命中即不发 `/line`、`snapped` 为真连 OSRM 也不请求。

**方向配色（全站唯一真源 `src/components/LineMap.vue` 的 `DIR_STYLE`）**：**上行青蓝 `#06B6D4`/`#22D3EE`，下行玫红 `#F43F5E`/`#FB7185`**（色盲友好）；环线统一用紫罗兰色系。上下行同屏分轨（自绘 3.5px、原生 14m），否则后画的会整条盖掉先画的。

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

实时车辆 UI（`LineStops.vue` / `LineMap.vue` / 车速榜 / 发车时刻）会显示还原后并补全的自编号（如 `319N2379`），MD5 原值保留备查。

**完整自编号补全（`src/utils/busNumber.js` + `src/static/data/bus-number-map.json`）**：MD5 字典只能还原出纯数字（如 `32379`），但真实车辆编号含批次码与车型字母（如 `319N2379`）。两套编号的对应关系是：**系统编号 = 公司号(首位) + 车号；buspedia 编号 = 公司号 + 批次码(1~2位，即年份后两位) + 车型字母 + 车号**——中间插入的批次码/字母无数字规律，只能查表。采集器 `scan-busnumber.mjs` 登录 buspedia 车队页，抓全集团车型的「自编号段」（如 `319N2379~2385`、`115Y562~596`）；**车型页按年份批次分多列，须抓所有含编号段特征的 `.data-cell`**（不能只取第一个，否则漏掉新年份），131 车型展开为 18614 个完整编号，按「公司号+车号」建映射 `byNum[系统编号] → [完整编号]`（车号前导零保留并同时登记去零版）。**新旧年份冲突**（同车号不同批次，如 `107E1314` 与 `117E1314`）按批次码降序排列，新年份排 `arr[0]` 优先显示。前端 `formatBusNo(orgId)` 查表补全显示，**原始纯数字 `orgId` 保持不变**（仍用于 MD5 反查车辆与公司推断）；映射表约 3.6MB，走 `uni.request` 懒加载 + 缓存 + `onBusNumberReady(cb)` 就绪回调（同 `busId.js` 模式），不打包进首屏。采集需 buspedia 账号（`BP_USER`/`BP_PASS`），页面有二次客户端重定向，须 `networkidle` + evaluate 重试才抓得到 `.data-cell`。映射表落 `src/static/data/bus-number-map.json`。

**衍生用途：营运公司反推**（`scripts/scan-org-live.mjs`）。自编号首位数字即营运公司（1→一公司 … 9→九公司），是车辆归属的权威判据：把 `/detailData` 在线车辆的 `busId` 经上述字典还原后取首位，按线路两方向合并投票取众数（护栏防跨公司支援车带偏），写入 `src/static/lines/lines.json` 的 `org`。这比停更的 buspedia 更准，专门补它未收录的 D/K/YX 线；因定制线多在班时段才有车，靠 CI 每 37 分钟反复跑累积覆盖。实测 1 路=二公司、337=三公司、10 路=七公司、408=一公司全部吻合。

**衍生用途：自编号尾号查车**（`utils/cityBus.js` 的 `searchBusesByOrgSuffix()`）。地图页「🔍 查车」按自编号**末尾数字**在全网快照里本地反查，不额外发请求：取用户输入末尾连续数字作尾号（`321B2426`→`2426`、`325F311`→`311`），对每辆车的纯数字 `orgId` 做 `endsWith`，因此**跨所有公司**——输入后四位 `2426` 即列出全集团所有尾号为 2426 的车，输入后三位 `426` 则放宽到所有 426 结尾。至少 2 位数字（低于 2 位噪声太大），输入即查、实时呈现多结果列表（线路/方向/完整自编号/走向/车速/公司），点行选中车辆并在地图定位；完整编号靠 `parseBusNo()` 反查或显示编号直配做精确命中。⚠️ 尾号匹配只依赖已还原的 `orgId`，字典未就绪时该车不在结果里；收班车也不在快照内。

### `arrived` 字段语义（实测）

| 值 | 含义 |
| -- | ---- |
| `"1"` | 已到站（距最近站点通常 3~12m） |
| `"0"` | 行驶中（距最近站点通常 48~281m） |

---

## 六、线路详情（站点 UI）

线路详情不再单独成页，而是以 `FloatWin` 浮窗嵌在地图页里，由 `src/components/LineStops.vue` 承载站点 / 时刻表 / 换乘 / 线路带等全部 UI；`LineMap.vue` 负责地图上的走向与实时车辆。

### 站点列表：横版卡片 + 横向滚动

- 站点以**横向线路带 + 站点卡片**呈现，可左右滑动（PC 支持鼠标拖拽 / 滚轮横向滚动）
- 每张卡片：站号徽章（首站绿 / 末站红）+ 站名 + 地铁换乘标签 + 该站实时车辆
- 车辆卡片：`自编号 | 状态 | 时间` 一行，`车速 · 距本站距离` 一行（不折行）
- 营运信息（首班 / 末班 / 票价 / 站点数 / 在线数）横向单行布局
- 线路带色随方向切换：上行青蓝 / 下行玫红 / 环线紫罗兰

> ⚠️ 实现要点：滚动容器内的内容行必须**收缩到自身宽度**才能产生滚动距离。
> uni-app H5 的 `scroll-view` 默认把内容行压到容器宽（`display:flex`），导致卡片溢出裁切而非滚动。
> 解决：内容行改用 `display: inline-flex`（shrink-to-fit）+ `min-width: 100%`（见 `LineStops.vue` 的 `.strip-inner` / `.min-stop-row` 处）。

### 线路走向总览

线路带：站点按**沿线路累计里程比例**分布（非等距，由 `geo.js` 计算），车辆按最近站位插值定位并错开显示。

### 极简站牌与实时刷新

- 浮窗窗头的 `🚏` 切换「极简站牌」模式：只留线路头、候车信息与站点序列
- 实时数据默认 15 秒自动刷新，间隔可在刷新胶囊里调 0 / 15 / 20 / 30 秒（`whbis:line-refresh-sec`，与地图页的 `whbis:map-refresh-sec` 各自独立）
- 定时器 `onShow` 拉起，`onHide` + `onUnload` 停止；浮窗拖动 / 缩放由 `panelPos.js` + `panelResize.js` 统一管理

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

- 源码分支（`main` / `BETA`）—— 仅本地维护，**严禁推送远端**
- `pages` —— 远端 `origin` 唯一接收的分支，仅存放 H5 构建产物，Pages 从该分支根目录发布；用孤立提交强推，产物不含源码历史

---

## 八、下一步计划

- [x] 工程初始化、架构搭建、双端构建验证
- [x] 接口协议破解（POST + header openId）
- [x] MD5 车辆编号还原 + 完整自编号补全（buspedia 映射）
- [x] 真实数据联调：线路 / 站点 / 时刻表 / 实时车辆 / 地图
- [x] H5 生产部署：Cloudflare Worker 反代 + GitHub Pages 一键部署
- [x] 线路收藏（`whbis:fav-lines:v1`，上限 10 条）+ 文本/Excel/图片三档复制
- [x] 蔡城 / 木兰 / 汉奇非集团线路统一纳入检索与全市线网
- [x] 本地账号制（预置账号 + 可选改密）
- [ ] 配置高德 Key，验证 Android 真机原生地图
- [ ] 公交到站距离估算（基于 GPS 与站点坐标）
- [ ] 如需原生渲染体验，评估 nvue / uni-app x 路线