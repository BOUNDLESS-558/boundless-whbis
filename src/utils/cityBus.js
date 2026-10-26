/**
 * 全市公交数据层 —— 线网底图 + 在运车辆快照
 *
 * 两块数据各自保鲜：
 *   1) 线网底图 `src/static/network.json`（静态资产，`npm run scan:net` 生成）：
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
import { allLines } from './lineIndex.js'
import { assetUrl } from './asset.js'
import { APP_CONFIG } from '../config.js'

const CACHE_KEY = 'whbis:city-snapshot:v1'
const WARN_KEY = 'whbis:city-warned'

// ────────────── 线网底图（静态资产）──────────────

/** 底图里只留内存，不进 localStorage：文件本身已被 HTTP 缓存，重复落盘只会顶满配额 */
let NET = null
let NET_PROMISE = null

/** 已加载好的线网（未加载返回 null）：{ updated, bbox, count, dirCount, dirs, byNo } */
export function cityNet() {
  return NET
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
      url: assetUrl('/static/network.json'),
      method: 'GET',
      timeout: 30000,
      success: (res) => {
        const body = res && res.statusCode === 200 ? res.data : null
        const net = normalizeNet(body && typeof body === 'string' ? safeJson(body) : body)
        if (!net) { NET_PROMISE = null; resolve(null); return }
        NET = net
        resolve(net)
      },
      fail: () => { NET_PROMISE = null; resolve(null) },
    })
  })
  return NET_PROMISE
}

function safeJson(s) {
  try { return JSON.parse(s) } catch (e) { return null }
}

/** 把生成器的存储形态（lines[].dirs[].p 展平坐标串）揉成渲染友好的索引 */
function normalizeNet(body) {
  if (!body || !Array.isArray(body.lines) || !body.lines.length) return null
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
  const q = String(orgId == null ? '' : orgId).trim()
  if (!q || !Array.isArray(buses) || !buses.length) return null
  const hash = md5(q)
  return buses.find((b) => b.busId === hash) || buses.find((b) => b.orgId === q) || null
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
  refreshOrgIds,
  clusterPoints,
  speedBandOf,
  SPEED_BANDS,
  cityNet,
  loadCityNet,
  netSearchLines,
  bboxIntersects,
}
