/**
 * 线路资产生成器：一次扫描两用（站点明细 + 离线算好的走向几何）
 *
 * 产物 src/static/lines/bNN.json（64 个哈希分片），每条线路：
 *   { no, dirs: { "0": { base, stops, route, snapped, source, algo, attempts, clean }, "1": {...} } }
 *   - base    : /line 的 lineDetailBaseDto 原样（LineStops 展示用）
 *   - stops   : 清洗后的精简站点明细（字段名与 stopDetailList 一致，LineMap / LineStops 零改动接入）
 *   - route   : 展平 [lng,lat,...] 的 GCJ-02 走向几何
 *   - snapped : true = 已有可用走向（amap 或 osrm）；false = 清洗后的站点连线（运行时后台补算）
 *   - source  : 'osrm' = 本脚本（B，免 Key 驾车路网近似）| 'amap' = scan-routes-amap.mjs（A，官方公交轨迹）
 *   - algo    : 本行所用算法版本（B=VERSION；A 写入更高值）。版本不匹配则重算，保证旧资产随算法升级刷新
 *
 * 为什么离线算：运行时那条链路是「逐站对独立规划 + 四级兜底」，受 OSRM 公共 demo
 * 限速与修复预算影响，会出现「一段贴路、一段长弦」的锯齿。离线可以慢慢跑、重试、
 * 断点续跑，把结果固化成静态资产：运行时 0 次 OSRM 请求，几何稳定可复现。
 *
 * A+B 混合：优先用高德官方公交轨迹（scan-routes-amap.mjs，需 Key，仅本地一次性采集，
 * 不进前端/仓库）；高德未收录的线路回退本脚本的 OSRM 贴路。本脚本永不覆盖 source:'amap'
 * 的行（A 是更优源），A 也只在 --force 时才重写自己的行。
 *
 * 只用免 Key 的 OSRM 公共服务（router.project-osrm.org），不依赖任何高德 Key / 付费服务。
 * 坐标口径：上游 /line 与高德瓦片都是 GCJ-02，OSRM 只认 WGS-84，故 GCJ→WGS 查询、
 * 结果 WGS→GCJ 后再落盘（与 src/utils/osrm.js 一致）。
 *
 * 用法：
 *   node scripts/scan-routes.mjs --only 337,221,261,287 --no-route   # 小样本：只拉站点+清洗，不算路
 *   node scripts/scan-routes.mjs --only 337                            # 含 OSRM 贴路（免 Key）
 *   node scripts/scan-routes.mjs --no-route                           # 全量：先出站点资产（快）
 *   node scripts/scan-routes.mjs                                      # 全量：补算贴路（慢，可续跑）
 *   node scripts/scan-routes.mjs --limit 200 --force                  # 分批重算
 *   node scripts/scan-routes.mjs --dry --only 337                     # 只统计不落盘
 *
 * 断点续跑：已存在且有效的方向会跳过；--no-route 产出的站点会被复用（不重复请求 /line），
 * 再跑一次不带 --no-route 即可把 snapped:false 升级为贴路几何。--force 强制全部重来。
 */
import fs from 'node:fs'
import path from 'node:path'
import RC from './_loadRouteClean.mjs'
import { gcj02ToWgs84, wgs84ToGcj02, haversine, maxExcursion } from './_geo.mjs'

const { cleanStops, pointsOf, simplify, toFlat, shardOf } = RC

// ── 上游 /line（与 scripts/scan-lines.mjs 同协议，见 AGENTS.md 三条铁律）──
const BASE = process.env.SCAN_BASE || 'https://customized.wuhanbus.com/gps-resapi/wechat/bus'
const CITY = '420100'
const HEADERS = { 'Content-Type': 'application/json', openId: 'wx_openid_dev_001' }
const COMMON = {
  cityCode: CITY,
  xiaomaAppId: 'wxaa1d01cdc96a2c0c',
  appKey: 'A0CADFE6F3B914A2',
  appType: 4,
  codeType: 1,
  channelId: 23000003,
  appSource: 2,
}

// ── OSRM 公共 demo（免 Key）──
const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const MAX_WAYPOINTS = 18
const SIMPLIFY_TOL = 0.00006 // ≈ 6.6m，与 src/utils/osrm.js 一致
const OSRM_TIMEOUT = 12000

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
const LIMIT = Math.max(0, Number(argOf('limit', 0)))
const CONCURRENCY = Math.max(1, Number(argOf('concurrency', 6)))
const DELAY = Math.max(0, Number(argOf('delay', 60)))
const OSRM_DELAY = Math.max(0, Number(argOf('osrm-delay', 300)))
const NO_ROUTE = has('no-route')
const FORCE = has('force')
const DRY = has('dry')
// 算法版本：v3 = stripLoops 多回环切除 + 保护环线；v4 = 坏 leg「加 1/3、2/3 途经点重试」
// 修复（消灭 211 型直线弦）。旧资产（algo 低于本版本）会被全部重算刷新。
const VERSION = 4

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 探测一个方向，返回完整 stopDetailList（不是只有坐标串） */
async function probe(code, dir) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + '/line', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ ...COMMON, lineCode: `${CITY}-${code}-${dir}` }),
        signal: AbortSignal.timeout(15000),
      })
      const payload = await res.json()
      if (payload && payload.success === true && payload.msg && payload.msg.code === '20000') {
        const data = payload.data || {}
        return { ok: true, base: data.lineDetailBaseDto || {}, stops: data.stopDetailList || [] }
      }
      const msg = (payload && payload.msg && payload.msg.message) || ''
      if (/线路找不到|不存在/.test(msg) || (payload && payload.msg && payload.msg.code === '3014')) {
        return { ok: false, reason: 'notfound' }
      }
      if (attempt === 2) return { ok: false, reason: 'biz:' + msg }
    } catch (e) {
      if (attempt === 2) return { ok: false, reason: 'net:' + (e && e.message ? e.message : e) }
    }
    await sleep(600 * (attempt + 1))
  }
  return { ok: false, reason: 'retry-exhausted' }
}

/** 简易并发池：保持顺序收集结果，单条失败不中断整体 */
async function pool(items, worker, concurrency) {
  const out = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
      if (DELAY) await sleep(DELAY)
    }
  })
  await Promise.all(runners)
  return out
}

// OSRM demo 会限速断连：所有算路请求串行排队，每次之间留间隔
let osrmTail = Promise.resolve()
function queueOsrm(fn) {
  const run = osrmTail.then(async () => {
    const r = await fn()
    if (OSRM_DELAY) await sleep(OSRM_DELAY)
    return r
  })
  osrmTail = run.catch(() => {})
  return run
}

/** 一批途经点（≤18）→ 逐 leg 的几何与距离 */
async function requestSegment(waypoints) {
  const coordPath = waypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `${OSRM}/${coordPath}?overview=full&geometries=geojson&steps=true`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT) })
      const j = await res.json()
      if (!j || j.code !== 'Ok' || !Array.isArray(j.routes) || !j.routes.length) return null
      const legs = j.routes[0].legs || []
      const out = legs.map((leg) => {
        const pts = []
        ;(leg.steps || []).forEach((st) => {
          ;((st.geometry && st.geometry.coordinates) || []).forEach(([lng, lat]) => pts.push({ lat, lng }))
        })
        return { pts, distance: leg.distance || 0 }
      })
      return out.length ? out : null
    } catch (e) {
      await sleep(1200 * (attempt + 1))
    }
  }
  return null
}

/** 结果不能跑到站点包围盒之外（外扩 25% 容纳真实绕行） */
function isSane(gcj, stopsGcj) {
  const lats = stopsGcj.map((p) => p.lat)
  const lngs = stopsGcj.map((p) => p.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const padLat = Math.max((maxLat - minLat) * 0.25, 0.003)
  const padLng = Math.max((maxLng - minLng) * 0.25, 0.003)
  return gcj.every((p) =>
    p.lat >= minLat - padLat && p.lat <= maxLat + padLat &&
    p.lng >= minLng - padLng && p.lng <= maxLng + padLng)
}

/**
 * 剔除「绕一大圈回到前方某点」的几何回环。
 * OSRM 用驾车 profile 规划公交走向：为避单行道 / 禁转，会绕街区几公里再回到之前的点附近
 * （273 路实测站点序列完全正常，几何却出现 13km 的回环）。这不是真实公交走向，
 * 而是驾车路网的绕行，画出来就是规整矩形。
 * 只删「绕行 >4km 且回到 80m 内」的极端回环，真实掉头（几百米）与小绕行不动。
 * 关键保护：只删「中段回环」（cut 之后仍有剩余路线），绝不把真正的环线（终点≈起点）
 * 整条删掉；最多切 maxCuts 次，避免极端数据下过度删除。
 */
function stripLoops(pts, minSeg = 4000, closeDist = 80, maxCuts = 8) {
  if (!pts || pts.length < 10) return { pts: pts || [], removed: 0 }
  const out = [pts[0]]
  let removed = 0
  let cuts = 0
  let i = 0
  while (i < pts.length - 1) {
    let cut = -1
    let segLen = 0
    for (let k = i + 1; k < pts.length; k++) {
      segLen += haversine(pts[k - 1], pts[k])
      if (segLen > minSeg && haversine(pts[i], pts[k]) < closeDist) { cut = k; break }
      if (segLen > 60000) break
    }
    // 中段回环才删（cut 之后还有路线）；真正的环线终点≈起点 → cut 落在末尾，不动
    if (cut > i + 1 && cut < pts.length - 1 && cuts < maxCuts) {
      removed += cut - i - 1
      cuts++
      i = cut // 跳过整个回环，从「回到起点」的那个点继续
      continue
    }
    out.push(pts[i + 1])
    i++
  }
  return { pts: out, removed }
}

/**
 * 整线算路：清洗后的站点序列 → GCJ-02 走向点列。
 * v4：坏 leg 不再直接退化成直线弦（截图 211 路的斜切来源），而是沿用运行时验证过的
 * 「加 1/3、2/3 途经点重试」修复：把坏 leg 拆两段重算，子段仍坏才回退弦。
 * 质检同 v2：驾车距离 ≤ straight*2.2+350、偏航 ≤ max(straight*0.5,260)；
 * 修复后坏段仍过半则整条退站点连线；最后剔除极端几何回环。
 */
async function routeAlongRoads(stops) {
  const gcjStops = pointsOf(stops)
  if (gcjStops.length < 2) return null
  const wgs = gcjStops.map((p) => gcj02ToWgs84(p.lat, p.lng))
  const acc = []
  let legsTotal = 0
  let legsBad = 0
  let repaired = 0
  const push = (p) => {
    const last = acc[acc.length - 1]
    if (!last || Math.abs(last.lat - p.lat) > 1e-8 || Math.abs(last.lng - p.lng) > 1e-8) acc.push(p)
  }
  // 单个 leg 的质检 + 上屏。bad 时只记数不推点，交给调用方决定「重试还是回退弦」。
  // count=false 用于修复重试的子 leg：不计入坏段比例（否则一次失败重试虚增 3 个坏段，
  // 会把「修复后仍差」误判成「坏段过半」而整条回退）。
  const judge = (a, b, leg, count = true) => {
    const straight = haversine(a, b)
    const allow = Math.max(straight * 0.5, 260)
    const good = leg && leg.pts && leg.pts.length > 1 &&
      leg.distance <= straight * 2.2 + 350 &&
      maxExcursion(leg.pts, a, b) <= allow
    if (count) { legsTotal++; if (!good) legsBad++ }
    return good
  }
  for (let i = 0; i < wgs.length - 1; i += MAX_WAYPOINTS - 1) {
    const seg = wgs.slice(i, Math.min(i + MAX_WAYPOINTS, wgs.length))
    if (seg.length < 2) break
    const legs = await queueOsrm(() => requestSegment(seg))
    if (!legs) return null // 服务不可用：整条交给上游回退站点连线，别产出半截几何
    for (let k = 0; k + 1 < seg.length; k++) {
      const a = seg[k], b = seg[k + 1], leg = legs[k]
      if (judge(a, b, leg)) leg.pts.forEach(push)
      else {
        // 修复：加 1/3、2/3 途经点重算（不是中点——中点容易落在同一个坏路网上）
        const m1 = { lat: a.lat + (b.lat - a.lat) / 3, lng: a.lng + (b.lng - a.lng) / 3 }
        const m2 = { lat: a.lat + (b.lat - a.lat) * 2 / 3, lng: a.lng + (b.lng - a.lng) * 2 / 3 }
        const sub = await queueOsrm(() => requestSegment([a, m1, m2, b]))
        let ok = false
        if (sub && sub.length === 3) {
          const g1 = judge(a, m1, sub[0], false), g2 = judge(m1, m2, sub[1], false), g3 = judge(m2, b, sub[2], false)
          if (g1 && g2 && g3) {
            sub[0].pts.forEach(push); sub[1].pts.forEach(push); sub[2].pts.forEach(push)
            ok = true
          }
        }
        if (!ok) [a, b].forEach(push); else repaired++ // legsBad 已在主质检计过一次，不再重复
      }
    }
    if (i + MAX_WAYPOINTS - 1 >= wgs.length - 1) break
  }
  if (acc.length < 2) return null
  // 修复后坏段仍过半：贴路意义不大，整条退成「清洗后的站点连线」，风格统一不混拼
  if (legsTotal && legsBad / legsTotal > 0.5) return null
  const gcj = acc.map((p) => wgs84ToGcj02(p.lat, p.lng))
  if (!isSane(gcj, gcjStops)) return null
  const cleaned = stripLoops(gcj)
  return simplify(cleaned.pts, SIMPLIFY_TOL)
}

/** 站点明细精简：保留运行时真正用到的字段，换乘只留 subwayLineNo */
function slimStops(stops) {
  return stops.map((s) => {
    const o = {
      stopId: s.stopId,
      stopName: s.stopName,
      stopNo: s.stopNo,
      latitude: s.latitude,
      longitude: s.longitude,
    }
    if (s.transferInfos && s.transferInfos.length) {
      const t = s.transferInfos.map((x) => ({ subwayLineNo: x.subwayLineNo })).filter((x) => x.subwayLineNo)
      if (t.length) o.transferInfos = t
    }
    return o
  })
}

// ── 分片读写（断点续跑的真正状态）──
const SHARDS = new Map()
const dirty = new Set()

function shardPath(key) { return path.join(OUT, key + '.json') }

function loadShard(key) {
  if (SHARDS.has(key)) return SHARDS.get(key)
  let data = { updated: '', version: VERSION, lines: {} }
  try {
    const raw = fs.readFileSync(shardPath(key), 'utf8')
    const j = JSON.parse(raw)
    if (j && j.lines && typeof j.lines === 'object') data = j
  } catch (e) { /* 文件不存在 / 损坏：从空分片开始 */ }
  SHARDS.set(key, data)
  return data
}

function rowOf(no, dir) {
  const shard = loadShard(shardOf(no))
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
    shard.version = VERSION
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

// ── 主流程 ──
if (!fs.existsSync(LIB)) { console.error('找不到线路库：' + LIB); process.exit(1) }
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const todo = []
for (const l of lib.lines || []) {
  if (l.status === '停运' || !l.stops) continue
  if (ONLY.length && !ONLY.includes(String(l.no))) continue
  for (const d of (l.dirs && l.dirs.length ? l.dirs : [0])) {
    todo.push({ no: String(l.no), code: l.code || l.no, dir: Number(d) || 0 })
  }
}
const all = LIMIT ? todo.slice(0, LIMIT) : todo
if (!DRY) fs.mkdirSync(OUT, { recursive: true })

const stats = { total: all.length, done: 0, skipped: 0, reused: 0, probed: 0, failed: 0,
  empty: 0, removed: 0, snapped: 0, fallback: 0, probeErr: 0 }
console.log(`线路资产：${all.length} 个方向，${NO_ROUTE ? '不' : ''}算路，并发 ${CONCURRENCY}，OSRM 间隔 ${OSRM_DELAY}ms${DRY ? '（dry，不落盘）' : ''}`)

let doneCount = 0
await pool(all, async (t) => {
  const prev = FORCE ? null : rowOf(t.no, t.dir)
  // A+B 混合：高德官方轨迹（source:'amap'）是更优源，本脚本（B）永不覆盖它，
  // 哪怕 --force 也不动——要刷新 amap 行请单独跑 scan-routes-amap.mjs。
  if (prev && prev.source === 'amap') { stats.skipped++; return }
  // 已完成判定：
  //  - 上游无有效站点已记 empty，不必每轮重拉（运行时仍会回退实时 /line，兜底能力不丢）
  //  - 算法版本匹配 + 结果有效 → 跳过；否则重算（命中新算法 / 修旧 bug）
  //  - 贴路失败累计 3 次就放弃重试，避免每次全量都卡在同一批坏线路上
  if (prev && prev.empty) { stats.skipped++; return }
  const prevAlgo = Number(prev && prev.algo) || 0
  const attempts = (prev && Number(prev.attempts)) || 0
  if (prevAlgo === VERSION && Array.isArray(prev.stops) && prev.stops.length >= 2 &&
      Array.isArray(prev.route) && prev.route.length >= 4 &&
      (NO_ROUTE || prev.snapped === true || (!NO_ROUTE && attempts >= 3))) {
    stats.skipped++
    return
  }

  let base, rawStops
  if (prev && Array.isArray(prev.stops) && prev.stops.length >= 2) {
    // 复用上一轮（--no-route）已拉到的站点，不重复打 /line
    base = prev.base || {}
    rawStops = prev.stops
    stats.reused++
  } else {
    const r = await probe(t.code, t.dir)
    if (!r.ok) { stats.failed++; stats.probeErr++; return }
    base = r.base
    rawStops = r.stops
    stats.probed++
  }
  const putEmpty = () => {
    putRow(t.no, t.dir, { base, stops: [], route: [], snapped: false, empty: true, clean: null })
    stats.empty++
  }
  if (!Array.isArray(rawStops) || rawStops.length < 2) { putEmpty(); return }

  const { stops, report } = cleanStops(rawStops)
  stats.removed += report.outliers + report.clusters + report.edge + report.dups + report.invalid
  if (stops.length < 2) { putEmpty(); return }

  let route = null
  let snapped = false
  if (!NO_ROUTE) {
    const r = await routeAlongRoads(stops)
    if (r && r.length > 1) { route = r; snapped = true; stats.snapped++ }
    else stats.fallback++
  }
  // 没贴路也要给一条「干净的站点连线」：运行时画实线，且不会像旧链路那样混进长弦
  if (!route) route = pointsOf(stops)

  putRow(t.no, t.dir, {
    base,
    stops: slimStops(stops),
    route: toFlat(route),
    snapped,
    source: 'osrm',
    algo: VERSION,
    // 贴路失败次数：累计 3 次后不再重试（--no-route 不算一次尝试）
    attempts: NO_ROUTE ? attempts : (snapped ? 0 : attempts + 1),
    clean: report,
  })
  stats.done++
  doneCount++
  if (doneCount % 25 === 0 || doneCount === all.length) {
    process.stdout.write(`\r  已处理 ${doneCount}/${all.length}（贴路 ${stats.snapped} / 复用 ${stats.reused} / 跳过 ${stats.skipped}）`)
    await requestFlush()
  }
}, CONCURRENCY)
await flushTail
flushDirty()
process.stdout.write('\n')

const files = [...SHARDS.keys()].filter((k) => !DRY && fs.existsSync(shardPath(k)))
console.log(`\n完成：新增/更新 ${stats.done} 个方向，跳过 ${stats.skipped}，复用站点 ${stats.reused}，新拉 /line ${stats.probed}`)
console.log(`清洗剔除 ${stats.removed} 个错误站点；贴路成功 ${stats.snapped}，回退干净连线 ${stats.fallback + (NO_ROUTE ? stats.done : 0)}`)
console.log(`分片 ${files.length} 个，本次写出 ${(writeBytes / 1024).toFixed(1)} KB${DRY ? '（dry 未落盘）' : ''}`)
if (stats.empty) console.log(`上游无有效站点 ${stats.empty} 个方向：已记 empty，运行时仍回退实时 /line，后续不再重复拉取`)
if (stats.failed) console.log(`⚠ /line 失败 ${stats.probeErr} 个方向，下次运行会自动重试（断点续跑）`)
process.exit(0)
