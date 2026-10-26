/**
 * OSRM 公共路由服务：把「站点序列」吸附到真实道路几何（完全免 Key）
 *
 * 为什么需要这一层：
 *  1. OSRM 的路网来自 OSM，坐标系是 WGS84；而武汉公交 API 与高德瓦片都是 GCJ-02。
 *     直接拿 GCJ-02 去查会整体偏 ~500m，必须先去偏查询、再把结果转回 GCJ-02 才能与底图对齐。
 *  2. 一次 GET 最多带 18 个途经点（URL 长度限制），站点多的线路分段拼接。
 *  3. 公共 demo 服务器有速率限制，故按「线路号-方向」缓存 7 天；缓存命中时零网络请求。
 *  4. 服务不可用 / 超时 / 结果离谱时一律返回 null，由调用方回退到站点连线，不影响主流程。
 *
 * 逐段质检用「最大垂距」而不是「规划距离 / 直线距离」（2026-10-26 用 337 路 28 段实测）：
 * 用 ratio 判会把两种情况完全判反——站前 112m 内的掉头绕行 ratio 11.7 但只偏离道路 76m，
 * 是真实走向；而吸附到龙阳大道高架后跑到 3km 外（ratio 17.3）才是真错。
 *
 * 坏段的真正病根（2026-10-26 用 /nearest 逐点验证）：
 * 站点坐标落在高架层或对向车道，OSRM 把端点吸到那条「错误的路」上，于是只能绕远路上的匝道。
 * 337 路 6 个坏段里 5 段换成邻近的其它车道路面后立刻恢复正常（如段5 1.30km→0.15km、
 * 段21 1.12km→0.25km），因此修复梯次为：
 *   贴走廊直接用 → 加途经点重算 → 换端点吸附候选重算 → 站间直线。
 * （实测 foot/walking 配置在 demo 服务器上返回的就是 car 几何、alternatives 与 exclude=motorway
 *  在 demo 上也拿不到额外结果，均不再使用）
 */
import { gcj02ToWgs84, wgs84ToGcj02, distance } from './geo.js'

const HOST_BASE = 'https://router.project-osrm.org'
const HOST = `${HOST_BASE}/route/v1/driving`
// 走向几何的算法版本变了就提升版本号，旧缓存自动失效
const CACHE_PREFIX = 'whbis:osrm-route:v5:'
const CACHE_TTL = 7 * 24 * 3600 * 1000
const MAX_WAYPOINTS = 18
const TIMEOUT = 9000
// 坏段修复次数上限：demo 服务器限速，宁可用直线兜底也不要把一条线打几十次请求
const MAX_REPAIRS = 12
// 端点吸附救援：每次要 2 次 /nearest + 最多 6 次两点规划，故只给少数几段预算
const MAX_SNAPS = 5
const SNAP_PAIRS = 6
// 吸附点离站点超过 60m 就不认：那已经不是「同一条路的另一条车道」而是隔壁街道了
const SNAP_MAX_DIST = 60
// 简化容差（度）：0.00006 ≈ 6.6m，肉眼看不出锯齿，点数能少一个量级
const SIMPLIFY_TOL = 0.00006

// ---- 缓存（uni.setStorageSync 在多端都有，App 端没有 localStorage）----
function readCache(key) {
  if (!key) return null
  try {
    const raw = uni.getStorageSync(CACHE_PREFIX + key)
    if (!raw || !raw.t || !Array.isArray(raw.pts)) return null
    if (Date.now() - raw.t > CACHE_TTL) return null
    return raw.pts
  } catch (e) {
    return null
  }
}

function writeCache(key, pts) {
  if (!key) return
  try {
    uni.setStorageSync(CACHE_PREFIX + key, { t: Date.now(), pts })
  } catch (e) { /* 存储满/隐私模式：忽略，只是下次重新请求 */ }
}

// ---- Douglas-Peucker 简化（直线加密点很多，不简化会拖慢 SVG 渲染）----
function perpDist(p, a, b) {
  const dx = b.longitude - a.longitude
  const dy = b.latitude - a.latitude
  const len2 = dx * dx + dy * dy
  if (!len2) return Math.hypot(p.longitude - a.longitude, p.latitude - a.latitude)
  let t = ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.longitude - (a.longitude + t * dx), p.latitude - (a.latitude + t * dy))
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = 0
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx !== -1 && maxD > tol) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  const out = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  return out
}

// ---- 走廊质检：几何点偏离「起→终连线」的最大垂距（米）----
function toMeters(p, lat0, lng0) {
  return {
    x: (p.lng - lng0) * 111320 * Math.cos((lat0 * Math.PI) / 180),
    y: (p.lat - lat0) * 110540,
  }
}

function maxExcursion(pts, a, b) {
  if (!Array.isArray(pts) || pts.length < 2) return Infinity
  const lat0 = (a.lat + b.lat) / 2
  const lng0 = (a.lng + b.lng) / 2
  const A = toMeters(a, lat0, lng0)
  const B = toMeters(b, lat0, lng0)
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len2 = dx * dx + dy * dy
  let max = 0
  for (const p of pts) {
    const P = toMeters(p, lat0, lng0)
    let t = len2 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy))
    if (d > max) max = d
  }
  return max
}

// 允许横向偏离：短站距给固定余量（一个街区的尺度），长站距按比例。
// 超过这个值的段一律不用规划结果——宁可画一条站间短直线，也不允许出现绕城大圈。
function corridorAllow(straight) {
  return Math.max(straight * 0.5, 260)
}

// 单段时间请求：waypoints 为 WGS84 的 {lat,lng}
// 返回按 leg（相邻两个途经点之间）拆分的几何，便于逐段校验绕路：
//   [{ pts: [{lat,lng}...], distance: 米 }]
function requestSegment(waypoints) {
  const coordPath = waypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `${HOST}/${coordPath}?overview=full&geometries=geojson&steps=true`
  return new Promise((resolve) => {
    uni.request({
      url,
      method: 'GET',
      timeout: TIMEOUT,
      success: (res) => {
        const j = res.data
        if (!j || j.code !== 'Ok' || !Array.isArray(j.routes) || !j.routes.length) return resolve(null)
        const legs = j.routes[0].legs || []
        const out = legs.map((leg) => {
          const pts = []
          ;(leg.steps || []).forEach((st) => {
            const c = (st.geometry && st.geometry.coordinates) || []
            c.forEach(([lng, lat]) => pts.push({ lat, lng }))
          })
          return { pts, distance: leg.distance || 0 }
        })
        resolve(out.length ? out : null)
      },
      fail: () => resolve(null),
    })
  })
}

// 修复请求：在 a→b 走廊的 1/3、2/3 处插两个途经点，把吸附到高架/旁支道路的路径拉回地面走廊
// 返回单条 WGS84 点列 [{lat,lng}]，失败 null
function requestLeg(a, b) {
  const lerp = (t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })
  const pts = [a, lerp(1 / 3), lerp(2 / 3), b]
  const coordPath = pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `${HOST}/${coordPath}?overview=full&geometries=geojson`
  return new Promise((resolve) => {
    uni.request({
      url,
      method: 'GET',
      timeout: TIMEOUT,
      success: (res) => {
        const j = res.data
        const coords = j && j.code === 'Ok' && j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates
        if (!Array.isArray(coords) || coords.length < 2) return resolve(null)
        resolve(coords.map(([lng, lat]) => ({ lat, lng })))
      },
      fail: () => resolve(null),
    })
  })
}

// 端点吸附候选：列出站点附近的路段（含道路名与吸附距离），用来识别「这条路吸错了」
// 返回 [{lat,lng,snap,name}]，snap 为站点到路段的距离（米）
function requestNearest(p) {
  const url = `${HOST_BASE}/nearest/v1/driving/${p.lng.toFixed(6)},${p.lat.toFixed(6)}?number=3`
  return new Promise((resolve) => {
    uni.request({
      url,
      method: 'GET',
      timeout: TIMEOUT,
      success: (res) => {
        const j = res.data
        if (!j || j.code !== 'Ok' || !Array.isArray(j.waypoints)) return resolve([])
        resolve(
          j.waypoints.map((w) => ({
            lat: w.location[1],
            lng: w.location[0],
            snap: w.distance || 0,
            name: w.name || '',
          }))
        )
      },
      fail: () => resolve([]),
    })
  })
}

// 两个吸附点之间的规划（只有 2 个途经点，比批量请求快得多）
function requestPair(a, b) {
  const coordPath = `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}`
  const url = `${HOST}/${coordPath}?overview=full&geometries=geojson&steps=true`
  return new Promise((resolve) => {
    uni.request({
      url,
      method: 'GET',
      timeout: TIMEOUT,
      success: (res) => {
        const j = res.data
        const leg = j && j.code === 'Ok' && j.routes && j.routes[0] && j.routes[0].legs && j.routes[0].legs[0]
        if (!leg) return resolve(null)
        const pts = []
        ;(leg.steps || []).forEach((st) => {
          const c = (st.geometry && st.geometry.coordinates) || []
          c.forEach(([lng, lat]) => pts.push({ lat, lng }))
        })
        resolve(pts.length > 1 ? { pts, distance: leg.distance || 0 } : null)
      },
      fail: () => resolve(null),
    })
  })
}

// 候选去重：同一路口的多个车道会返回几乎重合的点，留一个就够
function dedupeCandidates(list) {
  const out = []
  for (const c of list) {
    if (!c || !isFinite(c.snap) || c.snap > SNAP_MAX_DIST) continue
    if (out.some((o) => distance(o.lat, o.lng, c.lat, c.lng) < 6)) continue
    out.push(c)
  }
  return out
}

/**
 * 端点吸附救援：把 a、b 换成附近其它车道的路面再规划，按「吸附距离最短优先」逐个试
 * 站点被吸到高架层 / 对向车道时，这一手能把 1.3km 的匝道绕行拉回 150m 的正常车行道
 * @returns {Promise<Array<{lat:number,lng:number}>|null>}
 */
async function resolveBySnap(a, b, straight, allow) {
  const [ra, rb] = await Promise.all([requestNearest(a), requestNearest(b)])
  const ca = dedupeCandidates(ra)
  const cb = dedupeCandidates(rb)
  if (!ca.length || !cb.length) return null
  const pairs = []
  for (const x of ca) for (const y of cb) pairs.push({ x, y, cost: x.snap + y.snap })
  pairs.sort((p, q) => p.cost - q.cost)

  let best = null
  for (const { x, y } of pairs.slice(0, SNAP_PAIRS)) {
    const r = await requestPair(x, y)
    if (!r) continue
    const perp = maxExcursion(r.pts, a, b)
    // 两个吸附点挤到一起时走向长度会接近 0，那不是「绕开」而是「跳过」，必须剔除
    if (r.distance < straight * 0.8) continue
    if (perp <= allow) return r.pts
    // 次优：偏离稍大但仍是合理绕行（≤1.4 倍走廊且不超过 3 倍站距），比直线弦更像真实车行
    if (perp <= allow * 1.4 && r.distance <= straight * 3 + 300) {
      if (!best || perp < best.perp) best = { pts: r.pts, perp }
    }
  }
  return best ? best.pts : null
}

// 结果合理性校验：走向不能跑到站点包围盒之外（错配的线路会绕着城市跑一大圈）
function isSane(route, stops) {
  const lats = stops.map((s) => s.lat)
  const lngs = stops.map((s) => s.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  // 允许向四周外扩 25%（绕行、停车场掉头都算正常）
  const padLat = Math.max((maxLat - minLat) * 0.25, 0.003)
  const padLng = Math.max((maxLng - minLng) * 0.25, 0.003)
  return route.every(
    (p) =>
      p.latitude >= minLat - padLat &&
      p.latitude <= maxLat + padLat &&
      p.longitude >= minLng - padLng &&
      p.longitude <= maxLng + padLng
  )
}

/**
 * 定下一段的几何：贴走廊就用 → 加途经点重算 → 换端点吸附重算 → 站间直线
 * @param {Object} a 起点(WGS84) @param {Object} b 终点(WGS84)
 * @param {{pts:Array,distance:number}|null} leg 批量途经点请求给出的该段结果
 * @param {{left:number,snaps:number}} budget 修复次数预算
 */
async function resolveLeg(a, b, leg, budget) {
  const straight = distance(a.lat, a.lng, b.lat, b.lng)
  const allow = corridorAllow(straight)
  const hasGeo = leg && Array.isArray(leg.pts) && leg.pts.length > 1
  const perp = hasGeo ? maxExcursion(leg.pts, a, b) : Infinity
  // 距离上限作为辅助判据：沿原路前进几 km 再掉头回来时垂距很小，只有总距离能发现
  const sane = !!hasGeo && leg.distance <= straight * 8 + 1500

  // 1) 贴走廊，直接用
  if (sane && perp <= allow) return leg.pts

  // 2) 偏离走廊：加途经点重算一次（能拉回一部分被吸附到高架/单行道的段）
  if (straight >= 60 && budget.left > 0) {
    budget.left--
    const fixed = await requestLeg(a, b)
    if (fixed && maxExcursion(fixed, a, b) <= allow) return fixed
  }

  // 3) 端点吸附救援：换掉"吸错的那条路"再算（比直线弦真实得多）
  if (straight >= 60 && budget.snaps > 0) {
    budget.snaps--
    const snapped = await resolveBySnap(a, b, straight, allow)
    if (snapped) return snapped
  }

  // 4) 都不行：站间直线（平滑后是一部短连接线，不会画出绕城大圈）
  return [a, b]
}

/**
 * 把站点序列吸附到真实道路
 * @param {Array<{lat:number,lng:number}>} stops 站点坐标（GCJ-02，按行驶顺序）
 * @param {string} cacheKey 缓存键，建议 `${lineNo}-${dir}`
 * @returns {Promise<Array<{latitude:number,longitude:number}>|null>} GCJ-02 走向点列；失败为 null
 */
export async function fetchRoadRoute(stops, cacheKey) {
  if (!Array.isArray(stops) || stops.length < 2) return null
  // 走向调试输出：仅 H5 开发期打 console，发行包 / App 端为空操作
  const info = (m) => {
    // #ifdef H5
    if (process.env.NODE_ENV === 'production') return
    try { console.log(`[osrm] ${cacheKey}: ${m}`) } catch (e) { /* 忽略 */ }
    // #endif
  }
  const cached = readCache(cacheKey)
  if (cached && cached.length > 1) {
    info(`缓存命中 ${cached.length} 点`)
    return cached
  }

  // GCJ-02 → WGS84 后再查询（OSRM 只认 WGS84）
  const wgs = stops.map((s) => gcj02ToWgs84(s.lat, s.lng))
  const acc = []
  const budget = { left: MAX_REPAIRS, snaps: MAX_SNAPS }
  const stats = { kept: 0, repaired: 0, rescued: 0, fallback: 0 }
  const pushPt = (p) => {
    const last = acc[acc.length - 1]
    if (!last || Math.abs(last.lat - p.lat) > 1e-8 || Math.abs(last.lng - p.lng) > 1e-8) acc.push(p)
  }
  for (let i = 0; i < wgs.length - 1; i += MAX_WAYPOINTS - 1) {
    // 分段时相邻两段共用 1 个途经点，保证接缝连续
    const seg = wgs.slice(i, Math.min(i + MAX_WAYPOINTS, wgs.length))
    if (seg.length < 2) break
    const legs = await requestSegment(seg)
    if (!legs) {
      info(`第 ${i / (MAX_WAYPOINTS - 1) + 1} 批途经点规划失败（服务不可用或超时），整条回退站点连线`)
      return null
    }
    for (let k = 0; k + 1 < seg.length; k++) {
      const a = seg[k]
      const b = seg[k + 1]
      const beforeR = budget.left
      const beforeS = budget.snaps
      const pts = await resolveLeg(a, b, legs[k], budget)
      if (budget.snaps < beforeS) stats.rescued++
      else if (budget.left < beforeR) stats.repaired++
      else if (pts.length > 2) stats.kept++
      else stats.fallback++
      pts.forEach(pushPt)
    }
    if (i + MAX_WAYPOINTS - 1 >= wgs.length - 1) break
  }
  if (acc.length < 2) return null

  // WGS84 → GCJ-02，与站点、高德瓦片统一坐标系
  const gcj = acc.map((p) => {
    const g = wgs84ToGcj02(p.lat, p.lng)
    return { latitude: g.lat, longitude: g.lng }
  })
  if (!isSane(gcj, stops)) {
    info('走向跑到站点包围盒外，整条回退站点连线')
    return null
  }

  const slim = simplify(gcj, SIMPLIFY_TOL)
  if (slim.length > 1) writeCache(cacheKey, slim)
  // 开发期体检输出：走向有多少段直接可用 / 加途经点修复 / 换端点救援 / 不得不直线兜底
  info(
    `段统计 贴路:${stats.kept} 途经点修复:${stats.repaired} 端点救援:${stats.rescued} 直线兜底:${stats.fallback} 点数:${slim.length}`
  )
  return slim
}

export default { fetchRoadRoute }
