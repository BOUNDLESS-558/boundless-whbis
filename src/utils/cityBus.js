/**
 * 全市公交数据层 —— 线网底图 + 在运车辆快照
 *
 * 两块数据各自保鲜：
 *   1) 线网底图 `src/static/net/network.json`（静态资产，`npm run scan:net` 生成）：
 *      每条营运线每个方向的站点坐标串，用于在地图上画「全部线路走向」。
 *      为何不进 bundle 而是放 static：1000+ 条 / 5w+ 个站点≈ 1MB，import 进来会拖垮首屏；
 *      而它跟 lines.json 一样几乎不变，走 HTTP 缓存最划算（也因此不能进 localStorage，配额会顶满）。
 *   2) 在运车辆快照（90 秒新鲜期）：同时是「自编号 → 此刻在哪条线上」的反查索引。
 *
 * 为何需要快照而不是接口直给：后端只有「按 lineId 查单条线路在运车辆」的 /detailData，**没有全市车辆接口**
 * （23 个车辆类候选 path 实测全部 3008；新发现的 /search 只认线路号与站名，喂自编号返回空列表）。
 * 所以全市分布只能枚举线路库的全部方向逐个拉取后聚合：当前库内营运线 1064 条 / 1535 个方向，
 * 并发 8 约 60~90 秒（与参考图里「1549 个方向 · 耗时 59.3s」同一量级）。
 *
 * 一份快照两用：
 *   1) 分布图渲染源（速度分色圆点）；
 *   2) 自编号反查索引 —— 自编号 → md5() 本地正算 busId，在快照里 O(1) 命中它此刻在哪条线上。
 *      这条链路不需要任何离线数据库，快照本身就是索引（收班车不在快照里，符合预期）。
 *
 * ⚠ 配额：H5 生产环境的每个请求都过 Cloudflare Worker 反代（免费档 10 万次/天），
 *   一轮全市扫描 = 1535 次 ≈ 日配额 1.5%。因此：
 *     - 只在用户主动进入「全市公交」视图时才扫，且 90 秒内的缓存直接复用；
 *     - 线网底图是静态文件，**不占 API 配额**，画走向不额外花请求；
 *     - 自动跟随（周期性重扫）默认关闭，档位最低 5 分钟，且开启时明确提示代价；
 *     - 扫描在浏览器里并发直发，**不要**改成让 Worker 扇出（免费档单次调用只允许 50 个子请求）。
 */
import { fetchRealTime } from './api.js'
import { decryptBusId } from './busId.js'
import { md5 } from './md5.js'
import { parseBusNo, formatBusNo } from './busNumber.js'
import { allLines } from './lineIndex.js'
import { assetUrl } from './asset.js'
import { APP_CONFIG } from '../config.js'

/**
 * 包围盒长宽比（max(w,h)/min(w,h)）
 * 目标线路是横跨全市的大线（如 408 环线出过问题的 292 比例超大），
 * 其 bbox 会与任意视口区域都相交，形成视口全被它覆盖的假阳性。
 * 过滤阈值：长宽比 > 8 视为「跨城线路」（≥8成直角）或「短而胖线路」（成环可能为圆形）。
 * @param {Array} bb [minLng, minLat, maxLng, maxLat]
 * @returns {number} max(w,h)/min(w,h)
 */
export function bboxAspectRatio(bb) {
  if (!bb || bb.length !== 4 || bb[0] === Infinity) return 1
  const w = bb[2] - bb[0]
  const h = bb[3] - bb[1]
  if (w <= 0 || h <= 0) return 1
  return Math.max(w, h) / Math.min(w, h)
}

const CACHE_KEY = 'whbis:city-snapshot:v1'
const WARN_KEY = 'whbis:city-warned'

// ────────────── 线网底图（静态资产）──────────────

/** 底图里只留内存，不进 localStorage：文件本身已被 HTTP 缓存，重复落盘只会顶满配额 */
let BASE_NET = null   // 集团主线网（network.json 原样解析）
let NET = null        // 当前生效线网（开关开启时 = 主线网 + 非集团补充，同步可读）
let NET_PROMISE = null
let FOREIGN_BODY = null
let FOREIGN_PROMISE = null

/** 已加载好的线网（未加载返回 null）：{ updated, bbox, count, dirCount, dirs, byNo } */
export function cityNet() {
  return NET
}

/** 非集团线网补充资产（蔡城/木兰/汉奇），仅在开关开启时按需拉取 */
function loadForeignNet() {
  if (FOREIGN_PROMISE) return FOREIGN_PROMISE
  FOREIGN_PROMISE = new Promise((resolve) => {
    uni.request({
      url: assetUrl('/static/net/network-foreign.json'),
      method: 'GET',
      timeout: 20000,
      success: (res) => {
        const body = res && res.statusCode === 200 ? res.data : null
        FOREIGN_BODY = body && typeof body === 'string' ? safeJson(body) : body
        resolve(FOREIGN_BODY)
      },
      fail: () => resolve(null),
    })
  })
  return FOREIGN_PROMISE
}

/**
 * 把补充线网的方向条目转成与主线网同构的 dirs / byNo 增量，返回新的线网对象。
 * 开关关闭 / 资产缺失时返回主线网本身，保证集团视图行为逐点不变。
 * 合并结果是同步对象，cityNet() / netSearchLines() 等既有调用方无需改成异步。
 */
function mergeForeignNet(base, foreign) {
  if (!foreign || !Array.isArray(foreign.lines) || !foreign.lines.length) return base
  const dirs = base.dirs.slice()
  const byNo = new Map(base.byNo)
  for (const l of foreign.lines) {
    const entry = { no: l.no, code: l.code, dirs: [] }
    for (const d of l.dirs || []) {
      const raw = d.p
      if (!Array.isArray(raw) || raw.length < 4) continue
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
      const p = []
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const ln = Number(raw[i]), la = Number(raw[i + 1])
        if (!(ln > 73 && ln < 135) || !(la > 24 && la < 54)) continue
        p.push(ln, la)
        if (ln < minLng) minLng = ln
        if (ln > maxLng) maxLng = ln
        if (la < minLat) minLat = la
        if (la > maxLat) maxLat = la
      }
      if (p.length < 4) continue
      const dd = { no: l.no, code: l.code, dir: Number(d.d) || 0, p, n: p.length / 2, bb: [minLng, minLat, maxLng, maxLat] }
      entry.dirs.push(dd)
      dirs.push(dd)
    }
    if (entry.dirs.length) {
      entry.stops = entry.dirs.reduce((m, x) => Math.max(m, x.n), 0)
      byNo.set(String(l.no), entry)
    }
  }
  return { ...base, dirs, byNo, count: byNo.size, dirCount: dirs.length }
}

/** 重建生效线网：非集团补充资产恒定并入，不再有开关 */
async function rebuildNet() {
  if (!BASE_NET) return
  if (!FOREIGN_BODY) await loadForeignNet()
  NET = mergeForeignNet(BASE_NET, FOREIGN_BODY)
}

/**
 * 拉取全市线网底图。失败（资产还没生成 / 网络异常）返回 null 不抛：
 * 全市视图没底图仍然可以只画车辆，不该因为一个静态文件 404 就整块挂掉。
 */
export function loadCityNet() {
  if (NET) return Promise.resolve(NET)
  if (NET_PROMISE) return NET_PROMISE
  NET_PROMISE = new Promise((resolve) => {
    uni.request({
      url: assetUrl('/static/net/network.json'),
      method: 'GET',
      timeout: 30000,
      success: async (res) => {
        const body = res && res.statusCode === 200 ? res.data : null
        const net = normalizeNet(body && typeof body === 'string' ? safeJson(body) : body)
        if (!net) { NET_PROMISE = null; resolve(null); return }
        BASE_NET = net
        NET = net
        await rebuildNet()
        resolve(NET)
      },
      fail: () => { NET_PROMISE = null; resolve(null) },
    })
  })
  return NET_PROMISE
}

function safeJson(s) {
  try { return JSON.parse(s) } catch (e) { return null }
}

// 线网站序里相邻两站的距离上限（米）：超过就判为上游坐标错乱（实测有 287 路一段 79km
// 跳到广东、D650 等定制线 50km 跨城），这种段若照画就是横穿地图的「飞线」。
// ⚠ 阈值不能太低：武汉郊区线 / 快线相邻站 2.5~8km 属正常（全库这类有 584 段），
//   2.5km 会把大量正常线路切碎、出现「有站点却没线连」。实测 8km 是平衡点：
//   仍拦住全部 >20km 跨城飞线，却只影响 44 段、32 个畸形方向。
const NET_JUMP_MAX_M = 8000

/** 把生成器的存储形态（lines[].dirs[].p 展平坐标串）揉成渲染友好的索引 */
function normalizeNet(body) {
  if (!body || !Array.isArray(body.lines) || !body.lines.length) return null
  const R = 6371000, rad = (d) => (d * Math.PI) / 180
  const gapMeters = (lng1, lat1, lng2, lat2) => {
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.asin(Math.sqrt(a))
  }
  const dirs = []
  const byNo = new Map()
  for (const l of body.lines) {
    const entry = { no: l.no, code: l.code, dirs: [] }
    for (const d of l.dirs || []) {
      const raw = d.p
      if (!Array.isArray(raw) || raw.length < 4) continue
      // 重扫一遍做范围校验：旧资产（或上游异常数据）里的 0/0 缺位坐标会把走向拉到海里去
      const p = []
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const ln = Number(raw[i]), la = Number(raw[i + 1])
        if (!(ln > 73 && ln < 135) || !(la > 24 && la < 54)) continue
        p.push(ln, la)
        if (ln < minLng) minLng = ln
        if (ln > maxLng) maxLng = ln
        if (la < minLat) minLat = la
        if (la > maxLat) maxLat = la
      }
      if (p.length < 4) continue
      // 站点数（坐标对个数），用于远景挑主干线、近景全画
      const dd = { no: l.no, code: l.code, dir: Number(d.d) || 0, p, n: p.length / 2, bb: [minLng, minLat, maxLng, maxLat] }
      // 站序跳变检测：把 p 切成若干「连续子段」，飞线段与孤立坏点都不画。
      // dd.parts 是 [from,to] 索引对数组（左闭右闭），渲染侧逐段独立 M 起笔画，
      // 原生折线也按段画；没有跳变时就是整条 [[0,n-1]]。
      const ranges = []
      let start = 0
      const nPts = p.length / 2
      let hadJump = false
      // 只有 2 个站且相距 >阈值的定制线（D111 等）：不画实线飞线，但标记 suspect 供渲染侧
      // 画一条极淡虚线作为「这里有条线但坐标可疑」的提示，避免用户看到孤立站点却完全没有连线。
      const suspect2pt = nPts === 2 && gapMeters(p[0], p[1], p[2], p[3]) > NET_JUMP_MAX_M
      for (let i = 2; i < p.length; i += 2) {
        if (gapMeters(p[i - 2], p[i - 1], p[i], p[i + 1]) > NET_JUMP_MAX_M) {
          hadJump = true
          const end = i / 2 - 1 // 跳变前一点的索引
          // 至少 2 点才成线；定制线常见「起点/终点跨城」的 2 点方向，保留就是一条飞线，直接丢
          if (end - start >= 1) ranges.push([start, end])
          start = i / 2
        }
      }
      if (nPts - 1 - start >= 1) ranges.push([start, nPts - 1])
      // 有跳变但凑不出任何 ≥2 点的连续段（如 D1221 每两点都跨城）→ 标 suspect，不画实线飞线
      if (hadJump && !ranges.length) { dd.suspect = true; dd.parts = [[0, nPts - 1]] }
      else if (suspect2pt) { dd.suspect = true; dd.parts = [[0, nPts - 1]] }
      else dd.parts = ranges.length ? ranges : [[0, nPts - 1]]
      // 剔除跳变产生的孤立坏点后重算包围盒：否则单个跨城错点把 bb 撑到全省，
      // 让这条线永远「在视野内」白占预算，也可能把全览缩放拽飞。
      if (ranges.length > 1) {
        let nLng = Infinity, sLng = -Infinity, nLat = Infinity, sLat = -Infinity
        for (const [from, to] of ranges) {
          for (let i = from; i <= to; i++) {
            const ln = p[i * 2], la = p[i * 2 + 1]
            if (ln < nLng) nLng = ln
            if (ln > sLng) sLng = ln
            if (la < nLat) nLat = la
            if (la > sLat) sLat = la
          }
        }
        if (isFinite(nLng)) dd.bb = [nLng, nLat, sLng, sLat]
      }
      entry.dirs.push(dd)
      dirs.push(dd)
    }
    if (entry.dirs.length) {
      entry.stops = entry.dirs.reduce((m, x) => Math.max(m, x.n), 0)
      byNo.set(String(l.no), entry)
    }
  }
  if (!dirs.length) return null
  return {
    updated: body.updated || '',
    bbox: body.bbox || null,
    count: byNo.size,
    dirCount: dirs.length,
    stopCount: dirs.reduce((s, d) => s + d.n, 0),
    dirs,
    byNo,
  }
}

/** 线路号（支持不区分大小写的部分匹配）→ 命中条目，供全市视图的「按线路号查询」 */
export function netSearchLines(keyword, limit = 30) {
  if (!NET) return []
  const q = String(keyword == null ? '' : keyword).trim().toLowerCase()
  if (!q) return []
  const out = []
  NET.byNo.forEach((l) => {
    if (String(l.no).toLowerCase().includes(q) || String(l.code).toLowerCase() === q) out.push(l)
  })
  // 完全等于线路号的排前面，其余按线路号升序
  out.sort((a, b) => (a.no.toLowerCase() === q ? -1 : 0) - (b.no.toLowerCase() === q ? -1 : 0)
    || Number(a.no) - Number(b.no) || String(a.no).localeCompare(String(b.no)))
  return out.slice(0, limit)
}

/** 视口矩形（经度在前）与某方向的包围盒是否相交 */
export function bboxIntersects(bb, rect) {
  return bb && bb[2] >= rect.minLng && bb[0] <= rect.maxLng && bb[3] >= rect.minLat && bb[1] <= rect.maxLat
}


/** 快照「新鲜期」：期内再次进入全市直接复用，不重复打 1500+ 个请求 */
export const CITY_FRESH_MS = 90 * 1000
/** 快照「可用期」：超过就不自动复用（位置太旧没有意义），但仍可展示上次结果 */
export const CITY_STALE_MS = 15 * 60 * 1000
/** 并发数：浏览器对同一 host 的 HTTP/2 连接足够，再高只是给上游添堵 */
export const CITY_CONCURRENCY = 8

/**
 * 速度分档（分布图配色）。
 * 用「灰/绿/橙/红」这条通行梯度，而不是方向色的青蓝/玫红 —— 方向色已经表达上下行，
 * 这里表达的是快慢，两个维度不能撞色。色盲用户仍可读：详情窗里有车速数值与文字状态。
 */
export const SPEED_BANDS = [
  { key: 'idle', label: '静止', color: '#94A3B8', max: 0.5 },
  { key: 'slow', label: '<20', color: '#4ADE80', max: 20 },
  { key: 'mid', label: '20-40', color: '#F59E0B', max: 40 },
  { key: 'fast', label: '>40', color: '#EF4444', max: Infinity },
]

/** 车速 → 分档下标（0 静止 / 1 慢 / 2 常 / 3 快） */
export function speedBandOf(v) {
  const s = Math.max(0, Number(v) || 0)
  for (let i = 0; i < SPEED_BANDS.length; i++) if (s < SPEED_BANDS[i].max) return i
  return SPEED_BANDS.length - 1
}

const fmtGps = (t) => {
  const s = String(t || '')
  return s.length === 14 ? `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}` : '--'
}

/** 方向清单缓存：{ id(lineId), no(展示线路号), code(后端 lineCode 中段), dir } */
let DIRS = null

/**
 * 待扫方向 = 线路库里所有「营运中」线路的全部方向。
 * 停运线（探测不到站点数据）不扫：它们不会有任何在运车辆，扫了纯浪费请求。
 */
export function cityDirections() {
  if (DIRS) return DIRS
  const city = APP_CONFIG.cityCode
  const out = []
  for (const l of allLines()) {
    if (l.status === '停运' || !l.stops) continue
    const code = l.code || l.no
    const dirs = l.dirs && l.dirs.length ? l.dirs : [0]
    for (const d of dirs) out.push({ id: `${city}-${code}-${d}`, no: l.no, code, dir: d, name: l.name })
  }
  DIRS = out
  return out
}

/** 全市扫描的总请求数（用于向用户预告代价） */
export function citySweepCost() {
  return cityDirections().length
}

/**
 * 全网扫描一轮。
 * @param {Object} opts
 * @param {Function} [opts.onProgress] ({done,total,buses,failed}) => void，每 25 个方向回调一次
 * @param {Object} [opts.token] { cancelled:boolean } —— 置位后在途请求跑完即停，返回部分结果
 * @param {number} [opts.concurrency]
 * @returns {Promise<Object>} 快照 { at, ms, total, done, failed, lines, count, buses, partial }
 */
export async function sweepCity(opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || CITY_CONCURRENCY)
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null
  const token = opts.token || null
  const dirs = cityDirections()
  const t0 = Date.now()
  const buses = []
  const seen = new Set()
  const lines = new Set()
  let next = 0
  let done = 0
  let failed = 0

  const workers = Array.from({ length: Math.min(concurrency, dirs.length) }, async () => {
    while (true) {
      if (token && token.cancelled) return
      const i = next++
      if (i >= dirs.length) return
      const d = dirs[i]
      try {
        const data = await fetchRealTime(d.id)
        const list = (data && data.lineBusDtoList) || []
        list.forEach((b) => {
          const busId = b.busId || b.busNo
          if (!busId || seen.has(busId)) return
          const lat = parseFloat(b.latitude)
          const lng = parseFloat(b.longitude)
          if (isNaN(lat) || isNaN(lng)) return
          seen.add(busId)
          lines.add(d.no)
          buses.push({
            busId,
            // 自编号（MD5 字典还原；字典未就绪时为空，稍后由 refreshOrgIds 补）
            orgId: decryptBusId(busId) || '',
            no: d.no,
            code: d.code,
            dir: d.dir,
            lineName: d.name,
            lat,
            lng,
            // speed 用于分档；gpsSpeed 保留接口原值，让详情窗/状态判定与线路态共用同一套字段
            speed: parseFloat(b.gpsSpeed) || 0,
            gpsSpeed: b.gpsSpeed,
            arrived: b.arrived,
            time: fmtGps(b.gpsTime),
            band: speedBandOf(b.gpsSpeed),
          })
        })
      } catch (e) {
        // 单方向失败（线路找不到 / 超时）不影响整体，只计入 failed
        failed++
      }
      done++
      if (onProgress && (done % 25 === 0 || done === dirs.length)) {
        onProgress({ done, total: dirs.length, buses: buses.length, failed })
      }
    }
  })
  await Promise.all(workers)

  const cancelled = !!(token && token.cancelled)
  const snap = {
    at: t0,
    ms: Date.now() - t0,
    total: dirs.length,
    done,
    failed,
    lines: lines.size,
    count: buses.length,
    buses,
    // 部分结果（被取消或有失败方向）：不写缓存，避免下次直接复用一份残缺快照
    partial: cancelled || done < dirs.length || failed > 0,
  }
  if (!snap.partial) saveSnapshot(snap)
  return snap
}

/**
 * 只查一条线路的在运车辆（线路榜「查询」用）——按线路号找到它的各方向，
 * 逐方向调 /detailData（1~2 个请求，而不是全网 1500+），返回与快照同结构的车辆数组。
 * 车辆字段与 sweepCity 完全一致，便于 SpeedRank 直接复用 rankByLine 的行渲染。
 * @param {string} lineNo 线路号（337 / 337路 / code 内嵌号均可）
 * @returns {Promise<{at, buses, total, failed, lineNo}|null>} 无匹配线路返回 null
 */
export async function fetchLineVehicles(lineNo) {
  const raw = String(lineNo == null ? '' : lineNo).trim()
  const norm = (v) => String(v == null ? '' : v).trim().replace(/路$/, '').toUpperCase()
  const want = norm(raw)
  if (!want) return null
  // 线路库里该号的所有方向（营运中）；用归一后的线路号精确比对，
  // 输入 337 只匹配 337，不误命 D337/K337；code 中段参与匹配，兼容 420100-337-0
  const dirs = cityDirections().filter((d) => {
    const codeSeg = String(d.code || '').split('-')[1]
    return [d.no, d.name, codeSeg].some((v) => norm(v) === want)
  })
  if (!dirs.length) return { at: Date.now(), buses: [], total: 0, failed: 0, lineNo: raw, noMatch: true }

  const buses = []
  const seen = new Set()
  let failed = 0
  await Promise.all(dirs.map(async (d) => {
    try {
      const data = await fetchRealTime(d.id)
      const list = (data && data.lineBusDtoList) || []
      list.forEach((b) => {
        const busId = b.busId || b.busNo
        if (!busId || seen.has(busId)) return
        const lat = parseFloat(b.latitude)
        const lng = parseFloat(b.longitude)
        if (isNaN(lat) || isNaN(lng)) return
        seen.add(busId)
        buses.push({
          busId,
          orgId: decryptBusId(busId) || '',
          no: d.no,
          code: d.code,
          dir: d.dir,
          lineName: d.name,
          lat,
          lng,
          speed: parseFloat(b.gpsSpeed) || 0,
          gpsSpeed: b.gpsSpeed,
          arrived: b.arrived,
          time: fmtGps(b.gpsTime),
          band: speedBandOf(b.gpsSpeed),
        })
      })
    } catch (e) {
      failed++
    }
  }))
  return { at: Date.now(), buses, total: dirs.length, failed, lineNo: raw }
}

/** 读缓存快照；@param maxAge 允许的最大年龄（ms），超期返回 null */
export function loadSnapshot(maxAge = CITY_STALE_MS) {
  try {
    const s = uni.getStorageSync(CACHE_KEY)
    if (!s || !s.at || !Array.isArray(s.buses) || !s.buses.length) return null
    return Date.now() - s.at > maxAge ? null : s
  } catch (e) {
    return null
  }
}

/** 上次扫描结果（不论多旧都返回，用于「继续看上次结果 / 重扫」的提示） */
export function loadLastSnapshot() {
  try {
    const s = uni.getStorageSync(CACHE_KEY)
    return s && s.at && Array.isArray(s.buses) ? s : null
  } catch (e) {
    return null
  }
}

export function saveSnapshot(snap) {
  try {
    uni.setStorageSync(CACHE_KEY, snap)
  } catch (e) {
    /* 存储写满（快照约 200KB）只影响下次复用，不打扰用户 */
  }
}

/** 快照年龄（ms）；无快照返回 Infinity */
export function snapshotAge(snap) {
  return snap && snap.at ? Date.now() - snap.at : Infinity
}

/**
 * 自编号 → 快照里的车辆。
 * 正向 MD5 本地可算（无需字典、无需等 busId.js 就绪），所以这条反查在字典构建完成前也能用。
 * @param {string} orgId 用户输入的车辆自编号
 * @param {Array} buses 快照里的车辆数组
 */
export function findBusByOrgId(orgId, buses) {
  let q = String(orgId == null ? '' : orgId).trim()
  if (!q || !Array.isArray(buses) || !buses.length) return null
  // 地图标签显示的是完整编号（含车型字母，如 325F311 / T19H6230），
  // 快照里 busId=MD5(纯数字)、orgId 为纯数字。先尝试原样，再反查成纯数字。
  const hash = md5(q)
  let hit = buses.find((b) => b.busId === hash) || buses.find((b) => b.orgId === q)
  if (hit) return hit
  const plain = parseBusNo(q)
  if (plain && plain !== q) {
    const plainHash = md5(plain)
    hit = buses.find((b) => b.busId === plainHash) || buses.find((b) => b.orgId === plain)
  }
  if (hit) return hit
  // 最后按「每辆车的显示编号」直配：地图标签就是 formatBusNo(orgId)，
  // 用户照着标签输入时这条一定命中，不依赖映射表反查是否覆盖该编号
  const upper = q.toUpperCase()
  hit = buses.find((b) => b.orgId && formatBusNo(b.orgId).toUpperCase() === upper)
  return hit || null
}

/**
 * 按自编号「末尾数字」跨公司模糊匹配全市快照。
 *
 * 用户输入可能是完整编号（如 321B2426 / 325F311）或纯尾号（2426 / 426）。
 * 统一取末尾连续数字作为尾号，对每辆车的纯数字 orgId 做 endsWith 匹配：
 *   - 321B2426 → 尾号 2426 → 命中所有公司里自编号后四位 2426 的车
 *   - 426      → 尾号 426  → 命中所有自编号后三位 426 的车
 * 不做 MD5 反查（尾号无法反推完整编号），只依赖已还原的 orgId。
 *
 * @param {string} input 用户输入
 * @param {Array} buses 全市快照
 * @param {number} minLen 尾号最少位数，低于此值结果噪声太大直接返回空
 * @returns {{ digits: string, buses: Array }} 尾号与命中车辆（按线路/方向/自编号排序）
 */
export function searchBusesByOrgSuffix(input, buses, minLen = 2) {
  const raw = String(input == null ? '' : input).trim()
  const m = raw.match(/(\d+)\s*$/)
  const digits = m ? m[1] : ''
  if (digits.length < minLen || !Array.isArray(buses) || !buses.length) {
    return { digits, buses: [] }
  }
  const matched = buses.filter((b) => b && b.orgId && String(b.orgId).endsWith(digits))
  matched.sort((a, b) => {
    const c = String(a.no || '').localeCompare(String(b.no || ''), 'zh', { numeric: true })
    if (c) return c
    if (a.dir !== b.dir) return (a.dir || 0) - (b.dir || 0)
    return String(a.orgId).localeCompare(String(b.orgId))
  })
  return { digits, buses: matched }
}

/**
 * 补还原自编号（MD5 字典在后台构建，扫描时可能还没就绪）。
 * 就地改写字段，返回是否有变化（Vue 响应式数组元素属性变更可直接触发重算）。
 */
export function refreshOrgIds(buses) {
  let changed = false
  ;(buses || []).forEach((b) => {
    if (b.orgId) return
    const o = decryptBusId(b.busId)
    if (o) {
      b.orgId = o
      changed = true
    }
  })
  return changed
}

/** 是否已经提示过扫描代价（首次扫描前弹一次确认） */
export function cityWarned() {
  try {
    return !!uni.getStorageSync(WARN_KEY)
  } catch (e) {
    return true
  }
}

export function markCityWarned() {
  try {
    uni.setStorageSync(WARN_KEY, 1)
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 屏幕像素网格聚合：把密集的车点合并成带数量的团，避免一次性往地图上塞 1300 个标记。
 * 两种渲染模式共用 —— 先各自把经纬度投影成屏幕坐标，再进来聚合。
 * @param {Array<{x:number,y:number,b:Object}>} items 屏幕坐标 + 原始对象
 * @param {number} cellPx 网格边长（px）；<=0 表示不聚合
 * @returns {Array<{x:number,y:number,n:number,bus:Object|null}>} n===1 时带 bus
 */
export function clusterPoints(items, cellPx) {
  if (!(cellPx > 0) || items.length < 2) {
    return items.map((it) => ({ x: it.x, y: it.y, n: 1, bus: it.b }))
  }
  const cells = new Map()
  for (const it of items) {
    const key = Math.floor(it.x / cellPx) + ':' + Math.floor(it.y / cellPx)
    const c = cells.get(key)
    if (c) {
      c.n++
      c.sx += it.x
      c.sy += it.y
    } else {
      cells.set(key, { n: 1, sx: it.x, sy: it.y, bus: it.b })
    }
  }
  const out = []
  cells.forEach((c) => {
    out.push({ x: c.sx / c.n, y: c.sy / c.n, n: c.n, bus: c.n === 1 ? c.bus : null })
  })
  return out
}

export default {
  cityDirections,
  citySweepCost,
  sweepCity,
  loadSnapshot,
  loadLastSnapshot,
  saveSnapshot,
  snapshotAge,
  findBusByOrgId,
  searchBusesByOrgSuffix,
  refreshOrgIds,
  clusterPoints,
  speedBandOf,
  SPEED_BANDS,
  bboxAspectRatio,
  cityNet,
  loadCityNet,
  netSearchLines,
  bboxIntersects,
}
