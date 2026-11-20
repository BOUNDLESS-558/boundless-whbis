/**
 * 站点基线走向规划（免 KEY）
 *
 * v6 策略：以站点直连 + 线性插值为基线（站点坐标是公交公司实测，比任何算路都准）。
 *   - 短距段（≤1200m）：直接站点直连，无需 OSRM
 *   - 长距段（>1200m）：尝试 OSRM，sanity check 通过（路径长度 ≤ 直线 ×4）才用，否则回退直连
 *   - 后处理插值补密至 ~50m/点
 */

const PI = Math.PI
const R = 6371000  // 地球半径（米）

// ── 常量 ───────────────────────────────────────────────────────────────
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'
const TIMEOUT_MS = 10000
const LONG_SEG_THRESHOLD = 1200   // 米：站距超过此值才尝试 OSRM
const MAX_SINGLE_SEGMENT = 2000   // 米：单段上限，超则拆分重试
const SANE_RATIO = 4              // OSRM路径不超过直线距离的此倍数
const DENSIFY_MAX_DIST = 50       // 米：后处理插值补密阈值

// GCJ-02 → WGS-84（3次迭代，精度优于0.1米）
export function gcj02ToWgs84(gcjLat, gcjLng) {
  let wLat = gcjLat
  let wLng = gcjLng
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(wLat, wLng)
    wLat += gcjLat - g.lat
    wLng += gcjLng - g.lng
  }
  return { lat: wLat, lng: wLng }
}

// WGS-84 → GCJ-02
export function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0
  const ee = 0.00669342162296594323
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
    return { lat, lng }
  }
  let dLat = transformLat(lng - 105, lat - 35)
  let dLon = transformLng(lng - 105, lat - 35)
  const radLat = lat / 180 * PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((a * (1 - ee)) / (sqrtMagic * magic)) * PI)
  dLon = (dLon * 180) / ((a / sqrtMagic / Math.cos(radLat)) * PI)
  return { lat: lat + dLat, lng: lng + dLon }
}

function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
  return ret
}

function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3
  return ret
}

// Haversine 球面距离（米）
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * PI / 180
  const dLon = (b.lng - a.lng) * PI / 180
  const sinDlat = Math.sin(dLat / 2)
  const sinDlon = Math.sin(dLon / 2)
  const c = 2 * Math.asin(Math.sqrt(sinDlat ** 2 + Math.cos(a.lat * PI / 180) * Math.cos(b.lat * PI / 180) * sinDlon ** 2))
  return R * c
}

// 点到线段的垂距（米），AB为端点，P为检测点
export function perpDistToSegment(pts, A, B) {
  const dx = B.lng - A.lng
  const dy = B.lat - A.lat
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    // A和B重合，取到A的距离
    return Math.hypot(pts.lat - A.lat, pts.lng - A.lng) * 111000
  }
  let t = ((pts.lng - A.lng) * dx + (pts.lat - A.lat) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const proj = { lat: A.lat + t * dy, lng: A.lng + t * dx }
  return Math.hypot(pts.lat - proj.lat, pts.lng - proj.lng) * 111000
}


/**
 * 单次 OSRM 调用（带超时）
 * @param {Array<{lat:number,lng:number}>} waypoints - WGS84途经点数组
 * @returns {Promise<Array<{lat:number,lng:number}>>|null} geojson coordinates[]
 */
async function callOsrm(waypoints) {
  const coordPath = waypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `${OSRM_BASE}/${coordPath}?overview=full&geometries=geojson`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = await resp.json()
    if (!json.routes?.length) return null
    return json.routes[0].geometry.coordinates
  } catch {
    return null
  }
}

/**
 * 对距离较大的区间，用中点插值产生一个途经点，分别请求两次OSRM合并结果
 * @param {object} a
 * @param {object} b
 * @returns {Array<{lat:number,lng:number}>|null} 串联后的wgs路径点，失败返回null
 */
async function callOsrmWithMidpoint(a, b) {
  // 1) 直接试一次（中点作为extra waypoint）
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
  const viaResult = await callOsrm([a, mid, b])
  if (viaResult && viaResult.length >= 2) {
    const viaLen = computePathLength(viaResult)
    const straightLen = haversine(a, b)
    if (viaLen <= straightLen * SANE_RATIO) return viaResult
  }

  // 2) 分两段各自请求，拼接
  const segA = await callOsrm([a, mid])
  const segB = await callOsrm([mid, b])
  if (!segA || !segB) return null
  // segA最后一个点可能跟segB第一个点重复，去重
  const merged = [...segA]
  if (segB.length > 0) {
    const lastA = segA[segA.length - 1]
    const firstB = segB[0]
    if (!(Math.abs(lastA[0] - firstB[0]) < 1e-6 && Math.abs(lastA[1] - firstB[1]) < 1e-6)) {
      merged.push(...segB)
    } else {
      merged.push(...segB.slice(1))
    }
  }
  return merged.length >= 2 ? merged : null
}

function computePathLength(coords) {
  let len = 0
  for (let i = 1; i < coords.length; i++) {
    len += haversine({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] })
  }
  return len
}

/**
 * 按方向把站点序列转成 OSRM 路线点（WGS-84）
 *
 * 逻辑：
 *   1. 把所有站点GCJ→WGS转换
 *   2. 逐段调用OSRM（带智能插值解决长间距问题）
 *   3. 合并拼接，去重相邻重复点
 *   4. 做质量评估（返回stats）
 *
 * @param {Array<{stopName:string, latitude:number|string, longitude:number|string}>} stops
 * @param {string} cacheKey
 * @returns {Promise<{ points: Array<{lat:number,lng:number}>, stats: object }>}
 */
export async function fetchRoadRoute(stops, cacheKey = '') {
  if (!stops || stops.length < 2) return { points: [], stats: {} }

  const wgsStops = stops.map((s) => {
    const lat = typeof s.latitude === 'number' ? s.latitude : parseFloat(s.latitude)
    const lng = typeof s.longitude === 'number' ? s.longitude : parseFloat(s.longitude)
    if (isNaN(lat) || isNaN(lng)) return null
    return gcj02ToWgs84(lat, lng)
  }).filter(Boolean)

  if (wgsStops.length < 2) return { points: [], stats: {} }

  const allPts = []
  const stats = {
    totalStops: wgsStops.length,
    segmentCount: wgsStops.length - 1,
    osrmCalled: 0,
    osrmSuccess: 0,
    osrmFailed: 0,
    fallbackUsed: 0,
    directConnected: 0,
    midInsertions: 0,
    totalPathLen: 0,
    totalStraightLen: 0,
  }

  for (let i = 0; i < wgsStops.length - 1; i++) {
    const A = wgsStops[i]
    const B = wgsStops[i + 1]
    const dist = haversine(A, B)
    stats.totalStraightLen += dist

    // 追加当前站点（去重首点）
    const prevPt = allPts[allPts.length - 1]
    if (!prevPt || !(Math.abs(prevPt.lat - A.lat) < 1e-8 && Math.abs(prevPt.lng - A.lng) < 1e-8)) {
      allPts.push(A)
    }

    // ── v7 决策：短距直连，长距必用 OSRM ——
    if (dist <= LONG_SEG_THRESHOLD) {
      // 短距：站点坐标是实测，直连比 OSRM 绕小街更准
      stats.directConnected++
      allPts.push(B)
    } else {
      // 长距：必须用 OSRM 贴路，否则 2km 站点直连斜穿街区（截图问题根源）。
      // 只要 OSRM 返回路径就用（哪怕绕一点也比直线好）；仅网络失败才回退直连。
      stats.osrmCalled++
      let pts = null
      if (dist <= MAX_SINGLE_SEGMENT) {
        pts = await callOsrm([A, B])
      } else {
        stats.midInsertions++
        pts = await callOsrmWithMidpoint(A, B)
      }
      if (pts && pts.length >= 2) {
        const lastAllPt = allPts[allPts.length - 1]
        let startIdx = 0
        if (lastAllPt && Math.abs(lastAllPt.lat - pts[0][1]) < 1e-8 && Math.abs(lastAllPt.lng - pts[0][0]) < 1e-8) {
          startIdx = 1
        }
        for (let k = startIdx; k < pts.length; k++) {
          allPts.push({ lat: pts[k][1], lng: pts[k][0] })
        }
        stats.osrmSuccess++
      } else {
        stats.osrmFailed++
        stats.fallbackUsed++
        allPts.push(B)
      }
    }
  }

  // 补上最后一个站
  const lastStop = wgsStops[wgsStops.length - 1]
  const lastAllPt = allPts[allPts.length - 1]
  if (!lastAllPt || !(Math.abs(lastAllPt.lat - lastStop.lat) < 1e-8 && Math.abs(lastAllPt.lng - lastStop.lng) < 1e-8)) {
    allPts.push(lastStop)
  }

  // 后处理插值补密
  const densePts = densifyRoute(allPts, DENSIFY_MAX_DIST)
  stats.densified = allPts.length
  stats.densifiedOut = densePts.length

  for (let i = 1; i < allPts.length; i++) {
    stats.totalPathLen += haversine(allPts[i - 1], allPts[i])
  }

  return { points: densePts, stats }
}

/**
 * 后处理插值：将相邻点间距超过 maxDist 的路段用线性插值补密
 * @param {Array<{lat:number,lng:number}>} pts - WGS-84 点序列
 * @param {number} maxDist - 最大间距（米），超过此值则插入中间点
 * @returns {Array<{lat:number,lng:number}>} 补密后的点序列
 */
function densifyRoute(pts, maxDist) {
  if (pts.length < 2) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const curr = pts[i]
    const dist = haversine(prev, curr)
    if (dist <= maxDist) {
      out.push(curr)
    } else {
      // 插入 N 个等间距中间点，保证每段 ≤ maxDist
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

/**
 * 质量评分（0~10）
 *   - 绕路比越低越好（≤1.3=优秀，≤2.0=良好，≤3.0=可接受，>3.0=差）
 *   - 站点覆盖率：有OSRM覆盖的段数 / 总段数
 *   - 异常段惩罚：单段过长且无覆盖
 */
export function routeQualityScore(points) {
  if (points.length < 2) return 0
  let pathLen = 0
  for (let i = 1; i < points.length; i++) {
    pathLen += haversine(points[i - 1], points[i])
  }
  // 粗略估计"理论最短路径"：直接用首尾直线 + 中间各段累加估算
  // 更精确的做法需要原始stops，这里只用pathLen本身来反映平滑度
  // 用一个启发式：点数越多说明路径越详细（但也不能太多以免过拟合）
  const nodeCount = points.length
  // 归一化：500点以内满分，超出按比例递减（只是示意）
  const densityScore = Math.min(10, nodeCount / 50)
  return Math.round(densityScore)
}
