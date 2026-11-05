/**
 * 线路资产采集器（A）：高德官方公交轨迹，离线批量落盘。
 *
 * 这是 A+B 混合里的「A（更优源）」：高德公交信息查询接口 /v3/bus/linename 一次返回
 *   - polyline   : 公交公司上报的真实走向（沿固定线路、走专用道，不存在「驾车路网绕街区」问题）
 *   - busstops   : 官方站点序列（可顺带修正上游 /line 的「整段重复」病灶）
 * 用官方轨迹替换 B（OSRM 驾车近似）的几何，根治截图里那种规整矩形方框。
 *
 * 关键约束：
 *   - Key 只在我本地一次性采集时用（环境变量 AMAP_KEY），不进前端代码、不提交仓库。
 *   - 坐标口径：高德返回的是 GCJ-02，与上游 /line、资产落盘口径一致 → 直接存，无需转换。
 *   - 只写 source:'amap' 的行；已为 amap 的行默认跳过（--force 才重写）。绝不删除 B 的结果：
 *     高德没收录的线路（D/K 定制线等）A 不写，原 OSRM 行保持不动。
 *
 * 用法：
 *   $env:AMAP_KEY="你的高德Web服务Key"
 *   node scripts/scan-routes-amap.mjs --only 337,909,273      # 小样本先验证字段/覆盖率
 *   node scripts/scan-routes-amap.mjs                          # 全量（按免费额度限速）
 *   node scripts/scan-routes-amap.mjs --city 武汉 --delay 1100 # 控制 QPS（免费 1000~5000/日）
 *
 * 不写 Key 直接退出并提示。
 */
import fs from 'node:fs'
import path from 'node:path'
import RC from './_loadRouteClean.mjs'

const { cleanStops, pointsOf, simplify, toFlat, shardOf } = RC

const KEY = process.env.AMAP_KEY
const SECRET = process.env.AMAP_SECRET || ''
if (!KEY) {
  console.error('缺少高德 Web 服务 Key：请先设置环境变量 AMAP_KEY（本地一次性采集用，不会入库）。')
  console.error('  PowerShell:  $env:AMAP_KEY="你的Key"')
  console.error('  bash:        export AMAP_KEY="你的Key"')
  console.error('若 Key 开启了「签名校验」，还需设置 AMAP_SECRET（Key 详情里的安全密钥），否则会报 10001。')
  process.exit(2)
}
// 高德签名：所有参数（不含 key/sig）按名升序拼成 k=v&... 再追加安全密钥，MD5 小写。
// 仅当平台=「Web服务」且开启签名校验时才需要；不提供 SECRET 则按无签名方式请求。
import crypto from 'node:crypto'
function amapSig(params) {
  if (!SECRET) return ''
  const keys = Object.keys(params).filter((k) => k !== 'key' && k !== 'sig').sort()
  const str = keys.map((k) => `${k}=${params[k]}`).join('&') + SECRET
  return crypto.createHash('md5').update(str).digest('hex')
}

// ── 上游 /line（复用 scan-routes.mjs 的协议，拿清洗后的站点明细 + base）──
const BASE = process.env.SCAN_BASE || 'https://customized.wuhanbus.com/gps-resapi/wechat/bus'
const CITY = '420100'
const HEADERS = { 'Content-Type': 'application/json', openId: 'wx_openid_dev_001' }
const COMMON = {
  cityCode: CITY, xiaomaAppId: 'wxaa1d01cdc96a2c0c', appKey: 'A0CADFE6F3B914A2',
  appType: 4, codeType: 1, channelId: 23000003, appSource: 2,
}
const AMAP = 'https://restapi.amap.com/v3/bus/linename'
const AMAP_ALGO = 100 // 高于 B 的任何 VERSION，标识官方轨迹

// ── 参数 ──
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}
const has = (name) => argv.includes('--' + name)
const LIB = path.resolve(argOf('lib', 'src/static/lines.json'))
const OUT = path.resolve(argOf('out', 'src/static/lines'))
const ONLY = String(argOf('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const CITYNAME = argOf('city', '武汉')
const DELAY = Math.max(0, Number(argOf('delay', 1100)))
const FORCE = has('force')
const DRY = has('dry')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 分片读写（与 scan-routes.mjs 同结构，独立维护，避免互相耦合）──
const SHARDS = new Map()
const dirty = new Set()
const shardPath = (key) => path.join(OUT, key + '.json')
function loadShard(key) {
  if (SHARDS.has(key)) return SHARDS.get(key)
  let data = { updated: '', version: 0, lines: {} }
  try {
    const raw = fs.readFileSync(shardPath(key), 'utf8')
    const j = JSON.parse(raw)
    if (j && j.lines && typeof j.lines === 'object') data = j
  } catch (e) { /* 不存在/损坏：空分片 */ }
  SHARDS.set(key, data)
  return data
}
function rowOf(no, dir) {
  const shard = loadShard(String(no))
  const line = shard.lines[String(no)]
  return line && line.dirs && line.dirs[String(dir)]
}
function putRow(no, dir, row) {
  const key = shardOf(no)
  const shard = loadShard(key)
  const k = String(no)
  if (!shard.lines[k]) shard.lines[k] = { no: k, dirs: {} }
  shard.lines[k].dirs[String(dir)] = row
  dirty.add(key)
}
let writeBytes = 0
function flushDirty() {
  if (!dirty.size) return
  const keys = [...dirty]
  dirty.clear()
  for (const key of keys) {
    const shard = SHARDS.get(key)
    if (!shard) continue
    shard.updated = new Date().toISOString()
    const text = JSON.stringify(shard) + '\n'
    writeBytes += Buffer.byteLength(text)
    if (!DRY) fs.writeFileSync(shardPath(key), text, 'utf8')
  }
}
let flushTail = Promise.resolve()
function requestFlush() {
  flushTail = flushTail.then(() => flushDirty()).catch((e) => console.error('[flush]', e && e.message))
  return flushTail
}

// ── /line 探测（仅当现有资产缺该方向站点时用来补 stops/base）──
async function probe(code, dir) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + '/line', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ ...COMMON, lineCode: `${CITY}-${code}-${dir}` }),
        signal: AbortSignal.timeout(15000),
      })
      const payload = await res.json()
      if (payload && payload.success === true && payload.msg && payload.msg.code === '20000') {
        const data = payload.data || {}
        return { ok: true, base: data.lineDetailBaseDto || {}, stops: data.stopDetailList || [] }
      }
      if (attempt === 2) return { ok: false }
    } catch (e) { if (attempt === 2) return { ok: false } }
    await sleep(600 * (attempt + 1))
  }
  return { ok: false }
}

// 精简站点：保留展示与渲染必需字段，砍掉无用大字段（与 scan-routes.mjs 的 slimStops 一致）
function slimStops(stops) {
  return (stops || []).map((s) => {
    const o = {
      stopNo: s.stopNo, stopId: s.stopId, stopName: s.stopName,
      longitude: +s.longitude, latitude: +s.latitude,
    }
    if (s.stopType !== undefined) o.stopType = s.stopType
    if (s.transferInfos && s.transferInfos.length) {
      const t = s.transferInfos.map((x) => ({ subwayLineNo: x.subwayLineNo })).filter((x) => x.subwayLineNo)
      if (t.length) o.transferInfos = t
    }
    return o
  })
}

// ── 高德公交信息查询 ──
async function queryAmap(lineNo) {
  const params = {
    key: KEY, city: CITYNAME, keywords: String(lineNo),
    extensions: 'all', output: 'json', citylimit: 'true',
  }
  const sig = amapSig(params)
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + (sig ? `&sig=${sig}` : '')
  const url = `${AMAP}?${qs}`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      const j = await res.json()
      if (j && j.status === '1' && Array.isArray(j.buslines)) return j.buslines
      if (j && j.infocode === '10000' && j.status === '0') return [] // 查无此线
      // 额度/频率类报错先提示但不死循环
      if (j && (j.infocode === '10003' || j.infocode === '10004' || j.infocode === '10010')) {
        console.error(`  [amap] ${lineNo} 受限 ${j.infocode}，${attempt < 2 ? '退避重试' : '跳过'}`)
      }
      if (attempt === 2) return null
    } catch (e) { if (attempt === 2) return null }
    await sleep(800 * (attempt + 1))
  }
  return null
}

// 把高德 polyline 字符串（"lng,lat;lng,lat;..."，GCJ-02）解析为点列
function parsePolyline(s) {
  if (!s || typeof s !== 'string') return []
  const out = []
  for (const seg of s.split(';')) {
    const [lng, lat] = seg.split(',')
    const lo = parseFloat(lng), la = parseFloat(lat)
    if (!isFinite(lo) || !isFinite(la)) continue
    out.push({ lat: la, lng: lo })
  }
  return out
}

// 按起讫站名给方向匹配高德 busline：返回 { polyline, busstops, reversed }
function matchBusline(buslines, firstStop, lastStop) {
  if (!buslines || !buslines.length) return null
  const norm = (s) => (s || '').replace(/\s|站$/g, '')
  const f = norm(firstStop), l = norm(lastStop)
  let best = null, bestScore = -1
  for (const bl of buslines) {
    const s = norm(bl.start_stop), e = norm(bl.end_stop)
    let score = -1, reversed = false
    if (s && e) {
      if (f && f.includes(s) && l && l.includes(e)) score = 2
      else if (f && f.includes(e) && l && l.includes(s)) { score = 2; reversed = true }
      else if ((f && s.includes(f) && l && e.includes(l))) score = 1
      else if ((f && e.includes(f) && l && s.includes(l))) { score = 1; reversed = true }
    }
    if (score > bestScore) { bestScore = score; best = { bl, reversed } }
  }
  if (!best || bestScore < 1 || !best.bl.polyline) return null
  return { polyline: best.bl.polyline, busstops: best.bl.busstops || [], reversed: best.reversed }
}

// ── 主流程 ──
if (!fs.existsSync(LIB)) { console.error('找不到线路库：' + LIB); process.exit(1) }
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const lines = (lib.lines || []).filter((l) => l.status !== '停运' && l.stops)
const todo = ONLY.length ? lines.filter((l) => ONLY.includes(String(l.no))) : lines
if (!DRY) fs.mkdirSync(OUT, { recursive: true })

const stats = { total: todo.length, done: 0, skipped: 0, matched: 0, probe: 0,
  amapMiss: 0, dirMiss: 0, fallback: 0 }
console.log(`高德采集：候选 ${todo.length} 条线，城市 ${CITYNAME}，间隔 ${DELAY}ms${DRY ? '（dry，不落盘）' : ''}`)

let doneCount = 0
for (const l of todo) {
  const no = String(l.no)
  const dirs = (l.dirs && l.dirs.length ? l.dirs : [0]).map(Number)

  // 已全是 amap 且非强制 → 整条线跳过
  if (!FORCE && dirs.every((d) => { const r = rowOf(no, d); return r && r.source === 'amap' })) {
    stats.skipped++
    continue
  }

  const buslines = await queryAmap(no)
  if (buslines === null) { stats.amapMiss++; continue } // 接口失败：保留现有 B 行，下一轮重试
  if (!buslines.length) { stats.amapMiss++; continue }   // 高德未收录：保留现有 B 行

  let lineMatched = false
  for (const d of dirs) {
    const prev = rowOf(no, d)
    if (!FORCE && prev && prev.source === 'amap') { stats.skipped++; continue }

    // 取该方向的清洗后站点（优先复用现有资产，缺则补 /line）
    let base, rawStops
    if (prev && Array.isArray(prev.stops) && prev.stops.length >= 2) {
      base = prev.base || {}
      rawStops = prev.stops
    } else {
      const r = await probe(l.code || no, d)
      if (!r.ok) { stats.probe++; continue }
      base = r.base
      rawStops = r.stops
      stats.probe++
    }
    if (!Array.isArray(rawStops) || rawStops.length < 2) { stats.dirMiss++; continue }
    const { stops } = cleanStops(rawStops)
    if (stops.length < 2) { stats.dirMiss++; continue }

    // 用清洗后站点的首末站名匹配高德方向
    let firstStop = stops[0].stopName
    let lastStop = stops[stops.length - 1].stopName
    let m = matchBusline(buslines, firstStop, lastStop)
    if (!m) {
      // 回退：cleanStops 按 stopNo 排序可能把终点打乱（211 dir0 把「育才实验学校」
      // 排到「湖大知行学院」之后），改用清洗前物理首末站再试一次
      firstStop = (rawStops[0] && rawStops[0].stopName) || firstStop
      lastStop = (rawStops[rawStops.length - 1] && rawStops[rawStops.length - 1].stopName) || lastStop
      m = matchBusline(buslines, firstStop, lastStop)
    }
    if (!m) { stats.dirMiss++; stats.fallback++; continue }

    const pts = parsePolyline(m.polyline)
    if (pts.length < 2) { stats.dirMiss++; stats.fallback++; continue }
    // 高德 polyline 本就优化过，只做极轻抽稀去掉浮点抖动，不丢走向细节
    const route = simplify(pts, 0.00001)
    if (route.length < 2) { stats.dirMiss++; stats.fallback++; continue }

    putRow(no, d, {
      base,
      stops: slimStops(stops),
      route: toFlat(route),
      snapped: true,
      source: 'amap',
      algo: AMAP_ALGO,
      amap: { name: (m.busstops && buslines[0] && buslines[0].name) || null, reversed: m.reversed },
      clean: prev && prev.clean,
    })
    stats.matched++
    lineMatched = true
  }

  if (lineMatched) stats.done++
  doneCount++
  if (doneCount % 25 === 0 || doneCount === todo.length) {
    process.stdout.write(`\r  已处理 ${doneCount}/${todo.length}（amap 命中 ${stats.matched} 方向，未收录 ${stats.amapMiss}）`)
    await requestFlush()
  }
  if (DELAY) await sleep(DELAY)
}
await flushTail
flushDirty()
process.stdout.write('\n')

const files = [...SHARDS.keys()].filter((k) => !DRY && fs.existsSync(shardPath(k)))
console.log(`\n完成：写入 amap 方向 ${stats.matched} 个（覆盖线路 ${stats.done} 条），跳过 ${stats.skipped}`)
console.log(`高德未收录 ${stats.amapMiss} 条线（保留 OSRM 兜底），方向未匹配 ${stats.dirMiss}，补 /line ${stats.probe}`)
console.log(`分片 ${files.length} 个，本次写出 ${(writeBytes / 1024).toFixed(1)} KB${DRY ? '（dry 未落盘）' : ''}`)
console.log('提示：未命中 amap 的方向仍由 scan-routes.mjs 的 OSRM 几何兜底，无需手动处理。')
process.exit(0)
