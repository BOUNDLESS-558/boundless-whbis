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
import crypto from 'node:crypto'
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
const LIB = path.resolve(argOf('lib', 'src/static/lines/lines.json'))
const OUT = path.resolve(argOf('out', 'src/static/lines'))
const ONLY = String(argOf('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const LIMIT = Math.max(0, Number(argOf('limit', 0)))
const CONCURRENCY = Math.max(1, Number(argOf('concurrency', 6)))
const DELAY = Math.max(0, Number(argOf('delay', 60)))
const OSRM_DELAY = Math.max(0, Number(argOf('osrm-delay', 300)))
const NO_ROUTE = has('no-route')
const FORCE = has('force')
const DRY = has('dry')
// 增量变化检测：强制重新探测上游 /line，按站点序列签名与基线比对，
// 仅对「站点变化的线路」刷新 stops 并登记到 .changed-lines.txt，
// 供 scan-routes-amap.mjs --only-changed 增量重拉高德走向（省配额，实现「线路更新后获取最新走向」）。
const DETECT = has('detect-changes')
const SIG_PATH = path.resolve(argOf('sig', 'scripts/.stops-sig.json'))
const CHANGED_PATH = path.resolve(argOf('changed', 'scripts/.changed-lines.txt'))
const sigStore = {}
let sigSnapshot = ''
function loadSig() {
  try {
    const j = JSON.parse(fs.readFileSync(SIG_PATH, 'utf8'))
    if (j && typeof j === 'object') Object.assign(sigStore, j)
  } catch (e) { /* 首次运行：空基线 */ }
  sigSnapshot = JSON.stringify(sigStore)
}
function saveSig() {
  if (DRY) return
  const snap = JSON.stringify(sigStore)
  if (snap === sigSnapshot) return
  sigSnapshot = snap
  try { fs.mkdirSync(path.dirname(SIG_PATH), { recursive: true }); fs.writeFileSync(SIG_PATH, snap + '\n', 'utf8') } catch (e) {}
}
// 站点序列签名：站 id 优先，回退站名，避免纯改名（同 id）误判为变化
function sigOf(stops) {
  const s = (stops || []).map((x) => `${x.stopId || ''}:${x.stopName || ''}`).join('|')
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 16)
}
const changedSet = new Set()
// 算法版本：v3 = stripLoops 多回环切除 + 保护环线；v4 = 坏 leg「加 1/3、2/3 途经点重试」
// 修复（消灭 211 型直线弦）；v5 = 后处理插值补密稀疏段（DENSIFY_MAX_DIST=50m）
// v6 = 短距段（≤800m）跳过 OSRM 直接站点连线（消除算路偏差），长距 OSRM 更严格质检
// v7 = 修正 v6：长距段必须用 OSRM 贴路（2km 站点直连会斜穿街区），去掉整体回退
// v8 = map-matching 质检：长距段被拉成直线（偏离<50m）时判定 match 不可信，退回 /route
// v9 = 长距段改用独立 /route(overview=full) 顶层 geometry（steps geometry 偶发为空导致回退直连）
// v10 = 长距段绕路质检：绕行比 >2.5 且站距<1.5km 时回退站点直连（消除 OSRM 单行道大绕行）
// v11 = 分段 map-matching：整线 /match 因 URL 过长 TooBig，改为 6 点重叠块逐段匹配，
//        还原站点间道路弯折（通用「补点」方案，根治自绘底图模式的斜穿）
// v12 = stripLoops 改用绕行比判据（segLen>gap*6），删除 map-match 吸附错误产生的 1~2km 回环
const VERSION = 12
const SHORT_SEG_THRESHOLD = 800   // 米：站距低于此值直接用站点连线，不请求 OSRM
const DENSIFY_MAX_DIST = 50 // 米：后处理插值阈值——相邻点间距超过此值则插入中间点

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 后处理插值：将相邻点间距超过 maxDist 的路段用线性插值补密
 * 用于提高视觉渲染质量，不改变路径几何形状。
 */
function densifyRoute(pts, maxDist) {
  if (!pts || pts.length < 2) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const curr = pts[i]
    const dist = haversine(prev, curr)
    if (dist <= maxDist) {
      out.push(curr)
    } else {
      const nSegs = Math.max(2, Math.ceil(dist / maxDist))
      const dLat = (curr.lat - prev.lat) / nSegs
      const dLon = (curr.lng - prev.lng) / nSegs
      for (let j = 1; j < nSegs; j++) {
        out.push({ lat: prev.lat + dLat * j, lng: prev.lng + dLon * j })
      }
      out.push(curr)
    }
  }
  return out
}

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

/**
 * map-matching 质检：稀疏站点下 /match 会把「长距站点对」错误拉成纯直线
 * （实测 646 的「龙阳大道郭茨口→解放大道宗关」2km 跨江段偏离直线 0m，而真实道路
 * 需绕行 3km、偏离 459m）。若任一长距段被拉直，整条 match 不可信，退回分段 /route。
 */
function matchHasStraightLongSeg(matched, wgsStops) {
  for (let i = 0; i < wgsStops.length - 1; i++) {
    const A = wgsStops[i], B = wgsStops[i + 1]
    const straight = haversine(A, B)
    if (straight <= 1200) continue // 只查长距段
    // 找 match 路径上离 A、B 最近的点
    let iA = 0, iB = matched.length - 1, dA = Infinity, dB = Infinity
    for (let j = 0; j < matched.length; j++) {
      const d1 = haversine(A, matched[j]), d2 = haversine(B, matched[j])
      if (d1 < dA) { dA = d1; iA = j }
      if (d2 < dB) { dB = d2; iB = j }
    }
    if (iA >= iB) continue
    const seg = matched.slice(iA, iB + 1)
    // 该长距段若几乎是直线（偏离 <50m），说明 match 没还原真实绕行
    if (maxExcursion(seg, A, B) < 50) return true
  }
  return false
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
 * OSRM / map-matching 用驾车 profile 规划公交走向：为避单行道 / 禁转，或把稀疏站点吸附到
 * 错误小路，会绕一大圈再回到近乎同一点（646 实测绕 2.3km 却只前进 118m，画出来是个大环）。
 *
 * 判据用「绕行比」而非绝对距离：从点 i 累积走 segLen，若遇到点 k 距 i 很近（<closeDist）
 * 且 segLen 远大于这段净位移（segLen > gap*LOOP_RATIO），则为坏环。
 * 真实道路的小弯绕行 segLen≈gap，比值≈1，不会被误删。
 *
 * 关键保护：只删「中段回环」（cut 之后仍有剩余路线），绝不把真正的环线（终点≈起点）整条删掉。
 */
const LOOP_RATIO = 6 // 绕行长度 / 净位移 超过此值判为坏环
function stripLoops(pts, minSeg = 400, closeDist = 150, maxCuts = 12) {
  if (!pts || pts.length < 10) return { pts: pts || [], removed: 0 }
  // 闭合环线（首尾同站）整条就是「绕一圈回到起点」，不做回环剔除
  const span = pts.reduce((s, p, i) => i ? s + haversine(pts[i - 1], p) : 0, 0)
  if (haversine(pts[0], pts[pts.length - 1]) < 200 && span > minSeg) {
    return { pts, removed: 0 }
  }
  const out = [pts[0]]
  let removed = 0
  let cuts = 0
  let i = 0
  while (i < pts.length - 1) {
    let cut = -1
    let segLen = 0
    for (let k = i + 1; k < pts.length; k++) {
      segLen += haversine(pts[k - 1], pts[k])
      const gap = haversine(pts[i], pts[k])
      if (segLen > minSeg && gap < closeDist && segLen > gap * LOOP_RATIO) { cut = k; break }
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
 * 两点间独立 /route（overview=full），直接返回 geometry 点列。
 * 用于长距站点对：requestSegment 的 steps geometry 在 demo server 上偶发为空，
 * 而 overview=full 的顶层 geometry 稳定返回完整路径。
 */
async function requestPairRoute(a, b) {
  const coordPath = `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}`
  const url = `${OSRM}/${coordPath}?overview=full&geometries=geojson`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT) })
      const j = await res.json()
      if (!j || j.code !== 'Ok' || !j.routes?.length) return null
      const coords = j.routes[0].geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) return null
      return coords.map(([lng, lat]) => ({ lat, lng }))
    } catch (e) {
      if (attempt === 2) return null
      await sleep(1000 * (attempt + 1))
    }
  }
  return null
}

/**
 * OSRM map-matching（/match/v1/driving）——分段版。
 *
 * 整条线一次 /match 会因 URL 过长返回 TooBig（646 实测 35 站必失败）。
 * 改为切成 MATCH_CHUNK 个 waypoint 的重叠块逐段匹配：每块首点 = 上块末点，
 * 保证拼接连续；不带 radiuses（缩短 URL），坐标精度降到 5 位。
 * 每块质检绕路比（>4 判失败），失败块用 requestPairRoute 兜底；
 * 全部处理完返回拼接点列（WGS-84）。这是「自己补点」的通用实现：
 * 不去动站点坐标，只把站点序列吸附到真实路网，还原站点间的道路弯折。
 */
const MATCH_CHUNK = 6 // 每块 waypoint 数（实测 6 点在 demo server 上稳定成功、不 TooBig）
async function requestMatchAll(wgs) {
  if (wgs.length < 2) return null
  const pushDedup = (acc, p) => {
    const last = acc[acc.length - 1]
    if (!last || Math.abs(last.lat - p.lat) > 1e-8 || Math.abs(last.lng - p.lng) > 1e-8) acc.push(p)
  }
  const all = []
  for (let i = 0; i < wgs.length - 1; i += MATCH_CHUNK - 1) {
    const seg = wgs.slice(i, Math.min(i + MATCH_CHUNK, wgs.length))
    if (seg.length < 2) break
    const coordPath = seg.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
    const url = `${OSRM.replace('/route/v1/', '/match/v1/')}/${coordPath}?overview=full&geometries=geojson`
    let segPts = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT) })
        const j = await res.json()
        if (j && j.code === 'Ok' && j.matchings?.length) {
          const coords = j.matchings[0].geometry?.coordinates
          if (Array.isArray(coords) && coords.length >= 2) {
            segPts = coords.map(([lng, lat]) => ({ lat, lng }))
            break
          }
        }
      } catch (e) { /* 重试 */ }
      await sleep(400 * (attempt + 1))
    }
    // 质检：匹配路径绕路比 >4 视为异常，整块作废
    if (segPts && segPts.length > 1) {
      let plen = 0
      for (let k = 1; k < segPts.length; k++) plen += haversine(segPts[k - 1], segPts[k])
      const straight = haversine(seg[0], seg[seg.length - 1])
      if (straight > 100 && plen > straight * 4 + 500) segPts = null
    }
    // 块失败：用两点 /route 兜底该块首尾（宁可直段也不留空洞）
    if (!segPts || segPts.length < 2) {
      segPts = await requestPairRoute(seg[0], seg[seg.length - 1])
    }
    if (segPts) segPts.forEach((p) => pushDedup(all, p))
    await sleep(OSRM_DELAY)
  }
  return all.length >= 2 ? all : null
}

/**
 * 整线算路：清洗后的站点序列 → GCJ-02 走向点列。
 * v6：短距段（≤800m）跳过 OSRM，直接站点连线（站点坐标是最可靠来源）；
 *     长距段才请求 OSRM，且质检更严格（ratio≤1.5、偏航≤max(dist*0.3,150)），
 *     坏段过半时整体回退站点连线。
 */
async function routeAlongRoads(stops) {
  const gcjStops = pointsOf(stops)
  if (gcjStops.length < 2) return null
  const wgs = gcjStops.map((p) => gcj02ToWgs84(p.lat, p.lng))
  // 优先 map-matching：把站点序列贴合真实路网
  if (wgs.length >= 2 && wgs.length <= 100) {
    const matched = await queueOsrm(() => requestMatchAll(wgs))
    if (matched && matched.length >= 2 && !matchHasStraightLongSeg(matched, wgs)) {
      const gcj = matched.map((p) => wgs84ToGcj02(p.lat, p.lng))
      if (isSane(gcj, gcjStops)) {
        const cleaned = stripLoops(gcj)
        return densifyRoute(simplify(cleaned.pts, SIMPLIFY_TOL), DENSIFY_MAX_DIST)
      }
    }
  }
  const acc = []
  const push = (p) => {
    const last = acc[acc.length - 1]
    if (!last || Math.abs(last.lat - p.lat) > 1e-8 || Math.abs(last.lng - p.lng) > 1e-8) acc.push(p)
  }
  for (let i = 0; i < wgs.length - 1; i++) {
    const A = wgs[i], B = wgs[i + 1]
    const dist = haversine(A, B)
    // 追加 A（去重）
    const prevPt = acc[acc.length - 1]
    if (!prevPt || Math.abs(prevPt.lat - A.lat) > 1e-8 || Math.abs(prevPt.lng - A.lng) > 1e-8) {
      acc.push(A)
    }
    if (dist <= SHORT_SEG_THRESHOLD) {
      // 短距：站点直连（站点坐标是实测，直连比 OSRM 绕小街更准）
      acc.push(B)
    } else {
      // 长距：必须用 OSRM 贴路，否则 2km 站点直连会斜穿街区。
      // 只要 OSRM 返回了路径就用（哪怕不完美也比长距直线好）；仅网络失败才回退直连。
      // 单独 /route 两点 + overview=full，直接取 routes[0].geometry.coordinates。
      // （requestSegment 的 steps geometry 在 demo server 上偶发为空，导致长段被当成直连）
      const legPts = await queueOsrm(() => requestPairRoute(A, B))
      if (legPts && legPts.length > 1) {
        // 质检：OSRM 驾车 profile 为避单行道/禁转会绕大圈（实测 830m 站距绕 3.8km）。
        // 绕路比 >2.5 判定为无效绕行：短于 1.5km 用站点直连，更长则保留（长段直连会斜穿）。
        let pathLen = 0
        for (let k = 1; k < legPts.length; k++) pathLen += haversine(legPts[k - 1], legPts[k])
        if (pathLen <= dist * 2.5) {
          legPts.forEach(push)
        } else if (dist < 1500) {
          acc.push(B) // 中短距绕行：站点直连更忠实
        } else {
          legPts.forEach(push) // 长距：绕行也比斜穿直线好
        }
      } else {
        acc.push(B)
      }
    }
  }
  // 补上最后一个站
  const lastStop = wgs[wgs.length - 1]
  const lastPt = acc[acc.length - 1]
  if (!lastPt || Math.abs(lastPt.lat - lastStop.lat) > 1e-8 || Math.abs(lastPt.lng - lastStop.lng) > 1e-8) {
    acc.push(lastStop)
  }
  if (acc.length < 2) return null
  const gcj = acc.map((p) => wgs84ToGcj02(p.lat, p.lng))
  if (!isSane(gcj, gcjStops)) return null
  const cleaned = stripLoops(gcj)
  return densifyRoute(simplify(cleaned.pts, SIMPLIFY_TOL), DENSIFY_MAX_DIST)
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

// 集团分片统一落在 jt/ 子目录（与运行时 lineAsset.js 的 shardRel 对齐）
function shardPath(key) { return path.join(OUT, 'jt', key + '.json') }

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
loadSig()

const stats = { total: all.length, done: 0, skipped: 0, reused: 0, probed: 0, failed: 0,
  empty: 0, removed: 0, snapped: 0, fallback: 0, probeErr: 0, changed: 0 }
console.log(`线路资产：${all.length} 个方向，${NO_ROUTE ? '不' : ''}算路，并发 ${CONCURRENCY}，OSRM 间隔 ${OSRM_DELAY}ms${DRY ? '（dry，不落盘）' : ''}${DETECT ? '，增量检测开启' : ''}`)

let doneCount = 0
await pool(all, async (t) => {
  let prev = FORCE ? null : rowOf(t.no, t.dir)
  // ── 增量模式：强制重新探测上游 /line，按站点签名变化刷新 stops 并登记变化线路 ──
  if (DETECT) {
    const r = await probe(t.code, t.dir)
    if (!r.ok) { stats.failed++; stats.probeErr++; return }   // 临时故障：下轮重试
    const { stops } = cleanStops(r.stops)
    const sig = sigOf(stops)
    // 首轮无基线：用现有资产 stops 的签名作基线，避免一上来全量重拉
    const baseline = (sigStore[t.no] && sigStore[t.no][String(t.dir)]) || (prev ? sigOf(prev.stops) : null)
    sigStore[t.no] = sigStore[t.no] || {}
    sigStore[t.no][String(t.dir)] = sig
    // 仅当上游站点充足且与基线不一致时才视为变化：刷新 stops 并登记；
    // 上游临时返回空站（stops<2）不误判为变化，避免把正常线清成 empty。
    if (stops.length >= 2 && baseline !== sig) {
      changedSet.add(t.no)
      stats.changed++
      // 仅刷新 stops/base，保留原 route（高德几何交给 scan-routes-amap；OSRM 几何下方按需重算）
      putRow(t.no, t.dir, {
        ...(prev || {}),
        base: r.base,
        stops: slimStops(stops),
        // amap 线保留高德 route（稍后由 scan-routes-amap 刷新）；osrm 线清空以触发下方 OSRM 重算
        snapped: (prev && prev.source === 'amap') ? prev.snapped : false,
        source: prev ? prev.source : 'osrm',
        route: (prev && prev.source === 'amap') ? prev.route : [],
        attempts: (prev && prev.source === 'amap') ? prev.attempts : 0,
        clean: prev ? prev.clean : null,
      })
      prev = rowOf(t.no, t.dir)   // 用刷新后的行继续下方逻辑
    }
    // 落到下方既有 OSRM 逻辑：changed 的 osrm 线会用新 stops 重算几何；
    // 不变 / 已 amap 的线走既有跳过条件，不重复算路（省配额）。
  }
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
    // 退化保险：贴路结果至少要覆盖站点序列的多数（允许抽稀掉一半），且不少于 3 点。
    // 否则宁可标 snapped:false 回退站点连线，让运行时继续补算——
    // 绝不把「2 个重合点」当成有效贴路写盘，那会让前端跳过补算画出「一个点」。
    const minPts = Math.max(3, Math.ceil(stops.length / 2))
    if (r && r.length >= minPts) { route = r; snapped = true; stats.snapped++ }
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

if (DETECT) {
  saveSig()
  if (!DRY) {
    fs.mkdirSync(path.dirname(CHANGED_PATH), { recursive: true })
    const lines = [...changedSet].sort((a, b) => Number(a) - Number(b))
    fs.writeFileSync(CHANGED_PATH, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8')
  }
}

const files = [...SHARDS.keys()].filter((k) => !DRY && fs.existsSync(shardPath(k)))
console.log(`\n完成：新增/更新 ${stats.done} 个方向，跳过 ${stats.skipped}，复用站点 ${stats.reused}，新拉 /line ${stats.probed}`)
if (DETECT) console.log(`增量检测：站点变化的线路 ${stats.changed} 条${DRY ? '（dry 不落盘）' : `，已写入 ${path.relative(process.cwd(), CHANGED_PATH)}`}`)
console.log(`清洗剔除 ${stats.removed} 个错误站点；贴路成功 ${stats.snapped}，回退干净连线 ${stats.fallback + (NO_ROUTE ? stats.done : 0)}`)
console.log(`分片 ${files.length} 个，本次写出 ${(writeBytes / 1024).toFixed(1)} KB${DRY ? '（dry 未落盘）' : ''}`)
if (stats.empty) console.log(`上游无有效站点 ${stats.empty} 个方向：已记 empty，运行时仍回退实时 /line，后续不再重复拉取`)
if (stats.failed) console.log(`⚠ /line 失败 ${stats.probeErr} 个方向，下次运行会自动重试（断点续跑）`)
process.exit(0)
