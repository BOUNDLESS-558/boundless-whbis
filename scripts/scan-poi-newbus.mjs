/**
 * 线路资产采集器（兼容模式）：高德网页 SSR 接口 getPoiNewbus，免 Web 服务 Key 补充采集。
 *
 * 与 scan-routes-amap.mjs（/v3/bus/linename，需 Key）并列的第三种获取模式：
 *   - 域名 ditu.amap.com/ssr/api（高德网页前端 SSR 内部接口），不是 restapi.amap.com（官方 Web 服务）
 *   - 不需要高德 Web 服务 Key，与 linename 日配额池完全独立；但**必须带网页会话 Cookie**
 *     （未带 Cookie 实测返回 302 跳回 ditu.amap.com 首页，不是 401，很容易被误判成「接口挂了」）
 *   - 返回更丰富：地铁换乘 subways / 线路长度 length / 包围盒 bounds / 公司全称 company
 *     + 站点坐标 xy_coords、站点高德 POI id poiid2
 *
 * 前置 1：需先跑过 scan-routes-amap.mjs，资产里已写入 amap.id（线路 POI id，如 900000128833）。
 * 本采集器读回这些 id 逐线补充字段，不消耗任何 Key 额度。
 * （amap.id 来自 linename 响应 buslines[].id，命名空间与 getPoiNewbus 的 id 完全一致。）
 * 前置 2：设置环境变量 AMAP_WEB_COOKIE（从浏览器 DevTools 复制该域的完整 Cookie 串，不入库）。
 *   PowerShell:  $env:AMAP_WEB_COOKIE="amap_new_version_flag=1; ...; isg=..."
 *   bash:        export AMAP_WEB_COOKIE='...'
 * Cookie 里的 x-csrf-token / diu 会自动派生为 x-csrf-token / x-adiu 请求头。
 * 若网络需走代理，另设 NODE_USE_ENV_PROXY=1（Node 24+ 让内置 fetch 读 HTTPS_PROXY）。
 *
 * 用法：
 *   node scripts/scan-poi-newbus.mjs --only 337,909,273   # 小样本先验证 Cookie 是否有效
 *   node scripts/scan-poi-newbus.mjs                       # 全量（无需 AMAP_KEY）
 *   node scripts/scan-poi-newbus.mjs --overwrite           # 用 newbus 的 xs/ys 覆盖 route/stops
 *   node scripts/scan-poi-newbus.mjs --dry                 # 只统计、不落盘
 *   # 历史资产无 amap.id 时可直接指定 POI id 试跑（会回填 amap.id）：
 *   node scripts/scan-poi-newbus.mjs --ids 337:0:900000128833,681:0:900000162531 --dry
 *
 * 实测两例（337路 / 681路）结构完全一致：仅 id、keywords 随线路变化，city 恒为 420100。
 * 两例的浏览器请求都带同一套会话头；337路 只贴了 URL 而没贴请求头，不代表无需 Cookie。
 *
 * ⚠ www.amap.com/ssr/api 是高德网页 SSR 内部接口，字段名与返回格式可能随前端改版而变更，
 * 无公开文档保障；Cookie（尤其 isg）会过期，失效表现为 302，重新抓一份即可。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── 参数（必须在用到之前定义）──
const argv = process.argv.slice(2)
function arg(name, dflt) {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}
const has = (n) => argv.includes('--' + n)
const ONLY = String(arg('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const DELAY = Math.max(0, Number(arg('delay', 350)))
const DRY = has('dry')
const OVERWRITE = has('overwrite')
const OUT = path.resolve(ROOT, arg('out', 'src/static/lines'))
// 手工 id 映射：历史资产还没跑过新版主链路（无 amap.id）时可直接指定，
// 格式 "线路号:方向:POIid"，方向可省略（默认 0）。如 --ids 337:0:900000128833,681:0:900000162531
const IDS = new Map()
for (const item of String(arg('ids', '')).split(',').map((s) => s.trim()).filter(Boolean)) {
  const p = item.split(':').map((s) => s.trim())
  if (p.length === 3) IDS.set(`${p[0]}:${p[1]}`, p[2])
  else if (p.length === 2) IDS.set(`${p[0]}:0`, p[1])
}

const CITY = '420100'
const ENDPOINT = 'https://ditu.amap.com/ssr/api/getPoiNewbus'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
// 必需：网页会话 Cookie（实测未带会被 302 跳首页）。从浏览器 DevTools 复制，仅本地环境变量，不入库。
const COOKIE = process.env.AMAP_WEB_COOKIE || ''
if (!COOKIE) {
  console.error('缺少高德网页会话 Cookie：请先设置环境变量 AMAP_WEB_COOKIE（从浏览器 DevTools 复制 ditu.amap.com 的完整 Cookie 串）。')
  console.error('  PowerShell:  $env:AMAP_WEB_COOKIE="amap_new_version_flag=1; ...; isg=..."')
  console.error('  bash:        export AMAP_WEB_COOKIE=\'...\'')
  console.error('未带 Cookie 时该接口返回 302 跳回首页，不会返回数据。Cookie 不进仓库。')
  console.error('若网络需代理，另设 NODE_USE_ENV_PROXY=1（Node 24+ 让 fetch 读 HTTPS_PROXY）。')
  process.exit(2)
}
// Node 24+ 让内置 fetch 读取 HTTPS_PROXY / HTTP_PROXY（本机直连 www.amap.com 会超时）
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) {
  process.env.NODE_USE_ENV_PROXY = '1'
}
function cookieVal(name) {
  for (const part of COOKIE.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) } catch (e) { return part.slice(i + 1).trim() }
    }
  }
  return ''
}
const CSRF = cookieVal('x-csrf-token')
const ADIU = cookieVal('diu')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 分片读写（与 scan-routes-amap.mjs 同结构）──
const SHARDS = new Map()
const dirty = new Set()
// 分片按公司分子目录（jt/cc/ml/hq），递归收集所有分片文件
function shardPath(key, dir) { return path.join(OUT, dir, key + '.json') }
function listShardKeys() {
  const out = []
  for (const dir of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    const sub = path.join(OUT, dir)
    if (!fs.statSync(sub).isDirectory()) continue
    for (const f of fs.readdirSync(sub)) {
      if (/^(?:b\d+|CCB\d+|MLB\d+|HQB\d+)\.json$/.test(f)) out.push({ key: f.replace(/\.json$/, ''), dir })
    }
  }
  return out
}
function loadShard(key, dir) {
  const ck = dir + '/' + key
  if (SHARDS.has(ck)) return SHARDS.get(ck)
  let data = { updated: '', version: 0, lines: {} }
  try {
    const raw = fs.readFileSync(shardPath(key, dir), 'utf8')
    const j = JSON.parse(raw)
    if (j && j.lines && typeof j.lines === 'object') data = j
  } catch (e) { /* 不存在/损坏：空分片 */ }
  SHARDS.set(ck, data)
  return data
}
function saveShard(key, dir) {
  const shard = SHARDS.get(dir + '/' + key)
  if (!shard) return
  shard.updated = new Date().toISOString()
  const text = JSON.stringify(shard) + '\n'
  if (!DRY) fs.writeFileSync(shardPath(key, dir), text, 'utf8')
}

let sessionExpired = false
// ── 请求 getPoiNewbus（免 Web 服务 Key，需会话 Cookie）──
async function fetchNewbus(id, keywords) {
  if (sessionExpired) return null
  const url = `${ENDPOINT}?id=${encodeURIComponent(id)}&keywords=${encodeURIComponent(keywords)}&city=${CITY}`
  const referer = `https://ditu.amap.com/ssr/search/busline_detail?query_type=TQUERY&query=${encodeURIComponent(keywords)}` +
    `&city=${CITY}&busId=${encodeURIComponent(id)}&keywords=${encodeURIComponent(keywords)}&key_name=${encodeURIComponent(keywords)}`
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Referer': referer,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'Cookie': COOKIE,
  }
  if (CSRF) headers['x-csrf-token'] = CSRF
  if (ADIU) headers['x-adiu'] = ADIU
  try {
    // 不跟随重定向：未带/失效 Cookie 会 302 到 www.amap.com，必须显式识别，
    // 否则拿到一段 HTML 会被当成「接口无数据」，白跑全量。
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers, redirect: 'manual' })
    if (res.status !== 200) {
      if (res.status >= 300 && res.status < 400) {
        sessionExpired = true
        console.error(`\n  [newbus] ${res.status} 重定向到 ${res.headers.get('location') || '?'}：Cookie 缺失或已失效，请重新抓取 AMAP_WEB_COOKIE。`)
      }
      return null
    }
    const j = await res.json()
    if (!j || j.code !== 1 || !j.data || !Array.isArray(j.data.busline_list) || !j.data.busline_list.length)
      return null
    return j.data.busline_list[0]
  } catch (e) { return null }
}

// xs / ys 逗号串交叉配对成 [lng,lat,...] 展平点列
function routeFromXY(xs, ys) {
  if (!xs || !ys) return []
  const ax = xs.split(',').map(Number)
  const ay = ys.split(',').map(Number)
  const n = Math.min(ax.length, ay.length)
  const out = []
  for (let i = 0; i < n; i++) {
    if (!isFinite(ax[i]) || !isFinite(ay[i])) continue
    out.push(ax[i], ay[i])
  }
  return out
}

// 地铁换乘 subways → transferInfos。
// ⚠ 必须与上游 /line 的既有格式一致：前端 LineStops.vue 读 t.subwayLineNo 并拼「号线」，
// 写成 {line,status,color} 会导致标签空白。line_key 形如「12号线」「(在建)11号线四期」，取数字部分。
function transferInfosOf(station) {
  const subs = station.subways
  if (!Array.isArray(subs) || !subs.length) return []
  const out = []
  for (const s of subs) {
    const m = String(s.line_key || '').match(/(\d+)号线/)
    if (!m) continue
    const item = { subwayLineNo: m[1] }
    if (s.status === '3') item.building = true   // 在建
    if (s.color) item.color = s.color
    out.push(item)
  }
  return out
}
// 站名归一：两个数据源的站序未必一致，按站名匹配优先，避免把换乘信息挂到错误站点
const normStop = (s) => String(s || '').replace(/\s|[（(].*?[)）]|站$/g, '')

// ── 主流程 ──
// 分片按公司分子目录（jt/cc/ml/hq）：集团 bNN（64 桶哈希）+ 非集团 CCB/MLB/HQB + 两位桶号
const keys = listShardKeys()
let todo = []
for (const { key, dir: subdir } of keys) {
  const shard = loadShard(key, subdir)
  for (const [no, line] of Object.entries(shard.lines || {})) {
    if (!line.dirs) continue
    for (const [dirName, row] of Object.entries(line.dirs)) {
      const manual = IDS.get(`${no}:${dirName}`)
      const id = (row && row.amap && row.amap.id) || manual
      if (!id) continue
      if (ONLY.length && !ONLY.includes(String(no))) continue
      // 手工指定的 id 顺手回填，下轮起无需再带 --ids
      if (manual && row) {
        row.amap = row.amap || {}
        row.amap.id = manual
        dirty.add(subdir + '/' + key)
      }
      todo.push({ key, subdir, no, dir: dirName, id, row })
    }
  }
}
if (!DRY) for (const d of ['jt', 'cc', 'ml', 'hq']) fs.mkdirSync(path.join(OUT, d), { recursive: true })
if (!todo.length) {
  console.error('没有可用的线路 POI id：请先跑一次 npm run scan:routes:amap / npm run scan:foreign（需 AMAP_KEY）')
  console.error('让资产写入 amap.id；或用 --ids 337:0:900000128833,681:0:900000162531 直接指定后试跑。')
  process.exit(1)
}
console.log(`getPoiNewbus 兼容模式：候选 ${todo.length} 个方向，免 Web 服务 Key 补充采集` +
  `${DRY ? '（dry，不落盘）' : ''}`)

let done = 0, ok = 0, miss = 0, stopEnriched = 0
for (const t of todo) {
  if (sessionExpired) break
  const { key, subdir, no, dir, id, row } = t
  const keywords = /(路|线)$/.test(no) ? no : (/\d/.test(no) ? no + '路' : no)
  const bl = await fetchNewbus(id, keywords)
  if (!bl) { miss++; done++; continue }
  ok++
  const route = routeFromXY(bl.xs, bl.ys)
  const byName = new Map(), byNum = new Map()
  let subwayTotal = 0
  for (const st of (bl.stations || [])) {
    const ti = transferInfosOf(st)
    if (!ti.length) continue
    byName.set(normStop(st.name), ti)
    byNum.set(Number(st.station_num) || 0, ti)
    subwayTotal += ti.length
  }
  // 合并进 stops：补充 transferInfos（linename 不返回该字段）。
  // 按站名匹配优先（两源站序可能不同），匹配不到才退回站序，绝不硬按序号塞。
  if (Array.isArray(row.stops)) {
    for (const s of row.stops) {
      if (Array.isArray(s.transferInfos)) continue
      const ti = byName.get(normStop(s.stopName)) || byNum.get(Number(s.stopNo))
      if (ti) { s.transferInfos = ti; stopEnriched++ }
    }
  }
  row.amap = row.amap || {}
  row.amap.newbus = {
    id,
    keyName: bl.key_name || null,
    company: bl.company || null,
    length: bl.length || null,
    bounds: bl.bounds || null,
    subwayTotal,
    fetchedAt: new Date().toISOString(),
  }
  if (OVERWRITE && route.length >= 4) {
    row.route = route
    row.snapped = true
    row.algo = 100
    // 标记为主数据源：让辅助链路 scan-routes-amap 识别为「已由高德采集」，
    // 跳过补漏与 --backfill-stops，避免 linename 反过来覆盖 SSR 写好的站点/走向。
    row.source = 'amap'
    row.amap.primary = 'newbus'
    if (Array.isArray(bl.stations)) {
      row.stops = bl.stations.map((st) => {
        const [lng, lat] = String(st.xy_coords || '').split(';').map(Number)
        return {
          stopNo: Number(st.station_num) || 0,
          stopName: st.name,
          longitude: lng,
          latitude: lat,
          stopId: st.poiid2 || st.station_id || '',
          transferInfos: transferInfosOf(st),
        }
      })
    }
  }
  dirty.add(subdir + '/' + key)
  done++
  if (done % 25 === 0 || done === todo.length) {
    const msg = `  已处理 ${done}/${todo.length}（命中 ${ok}，未响应 ${miss}，补 transferInfos ${stopEnriched} 站）`
    if (process.env.GITHUB_ACTIONS) console.log(msg)
    else process.stdout.write(`\r${msg}`)
    await sleep(0)
  }
  if (DELAY) await sleep(DELAY)
}
for (const ck of [...dirty]) {
  const i = ck.lastIndexOf('/')
  saveShard(ck.slice(i + 1), ck.slice(0, i))
}
if (!DRY && !process.env.GITHUB_ACTIONS) process.stdout.write('\n')
console.log(`完成：命中 ${ok} / ${todo.length}，未响应 ${miss}；补充地铁换乘 ${stopEnriched} 站；写出分片 ${dirty.size} 个${DRY ? '（dry）' : ''}。`)
if (sessionExpired)
  console.log('已中止：会话 Cookie 失效（302）。请重新从浏览器抓取 www.amap.com 的 Cookie 设到 AMAP_WEB_COOKIE 后重跑。')
else if (miss > 0)
  console.log('提示：未响应的方向保留原资产不动，下轮自动重试；若成片未响应，多为 Cookie 限流，可调大 --delay。')
process.exit(sessionExpired ? 1 : 0)
