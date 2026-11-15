/**
 * 公交车航向 × 线路段向余弦相似度 —— 判断「这辆车此刻在这条线上往哪走」
 *
 * 背景：
 *   现有 LineMap.vue 的方向标签用「离终点站更近的才是当前方向」来判断。
 *   这种启发式在以下三种情况会误判：
 *   - 环线：所有终点站等距，永远选不上；
 *   - 返岔口：车已掉头但未到下一站，被错误归入反向；
 *   - 大站距跨区线（如 292 路单向 20 km）：车离某远端终点更近就被误标成往那边开。
 *
 * 新算法（基于航向向量与路线几何的方向一致性）：
 *   1) 计算车辆的瞬时运动向量 v（当前 GPS 减去上一 GPS，无 heading 字段时用此替代）。
 *      heading（真北朝向角，°）= atan2(v_lng, v_lat)，0=正北、顺时针为正。
 *   2) 在 polyline 上找到车辆投影点 closestSegment，算出该处的段向 s = (lng₂-lng₁, lat₂-lat₁)。
 *      段向与车辆航向夹角 θ = arccos(dot(v,s) / (|v||s|))，取值范围 [0, π]。
 *   3) 上行方向对应沿线前进（θ ≤ π/2），下行对应反沿线（θ > π/2）。
 *      阈值 60° 容差：公交站 GPS 有少量漂移，且市区单行/绕路会造成短暂方向偏转。
 *
 * 依赖：
 *   - distance() 来自 ../utils/geo.js（haversine），这里仅复用其语义。
 *
 * 返回值说明：
 *   direction: 0=沿线方向 / 1=反沿线方向 / null=无法判定（速度为零、polyline 太短等）
 *   confidence: [0,1] 越高越可信；低于 0.3 视为无效，调用方应降级回原有逻辑
 *
 * @module busDir
 */
import { distance } from './geo.js'

/**
 * 求两点间的航向角（度），0=正北顺时针递增，与 GPS heading 坐标系一致
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @returns {number}
 */
export function heading(from, to) {
  const dLng = (to.lng - from.lng) * Math.cos(((from.lat + to.lat) / 2) * Math.PI / 180)
  const dLat = to.lat - from.lat
  let ang = (Math.atan2(dLng, dLat) * 180) / Math.PI
  return (ang + 360) % 360
}

/**
 * 把角度规范化到 [-π, π] 区间，方便与另一个角度求最小差值
 * @param {number} deg
 * @returns {number}
 */
function normalizeAng(deg) {
  let r = ((deg % 360) + 360) % 360
  if (r > 180) r -= 360
  return (r * Math.PI) / 180
}

/**
 * 两航向角的绝对最小差值（弧度）
 * @param {number} a1 度
 * @param {number} a2 度
 * @returns {number} 弧度
 */
function angularDiffDeg(a1, a2) {
  return Math.abs(normalizeAng(a1) - normalizeAng(a2)) * (180 / Math.PI)
}

/**
 * polyline 上的最近投影段
 *
 * 给定一系列连续的 GCJ-02 坐标点（展开的 [lng,lat,...] 或 {lat,lng} 数组），
 * 找距 query 点欧氏距离（近似为直线段）最小的线段，以及投影比例 t ∈ [0,1]。
 * 注意：这里不做 haversine 精算，因为段长度本身通常只有几十到几百米，
 * 直线近似足够区分方向；精确距离用外面已有的 distance()。
 *
 * @param {Array} segs polyline 坐标序列（两种格式都支持）
 * @param {{lat:number,lng:number}} query
 * @returns {{i:number, t:number, px:number, py:number}} i 为所在段的起始索引，t 为段内比例
 */
export function projectOnPolyline(segs, query) {
  const arr = Array.isArray(segs[0]) && typeof segs[0][0] === 'number'
    ? segs.map(([lng, lat]) => ({ lat, lng }))
    : segs

  let bestDist = Infinity
  let bestI = 0
  let bestT = 0
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1]
    const dx = b.lng - a.lng
    const dy = b.lat - a.lat
    const len2 = dx * dx + dy * dy
    let t = len2 > 0 ? ((query.lng - a.lng) * dx + (query.lat - a.lat) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const cx = a.lng + t * dx
    const cy = a.lat + t * dy
    const d = (cx - query.lng) ** 2 + (cy - query.lat) ** 2
    if (d < bestDist) {
      bestDist = d
      bestI = i
      bestT = t
    }
  }
  const proj = {
    lat: arr[bestI].lat + bestT * (arr[bestI + 1].lat - arr[bestI].lat),
    lng: arr[bestI].lng + bestT * (arr[bestI + 1].lng - arr[bestI].lng),
  }
  return { i: bestI, t: bestT, px: proj.lng, py: proj.lat }
}

/**
 * 给定「车辆当前位置 + 上一位置（或航向）」与「线路 polyline」，判断当前行驶方向
 *
 * 返回：
 *   { direction: 0 | 1 | null, confidence: number }
 *   - direction: 0 表示与 polyline 同向，1 表示反向，null 表示无法判定
 *   - confidence: [0,1]，越大越可信；建议 ≥ 0.3 才采信，否则降级
 *
 * 降级路径（调用方自己决定）：
 *   - 如果 vehicles[0] 有 `heading` 字段（高德返回），优先用它而非位移向量；
 *   - 如果 polyline 太短（< 3 点），退回「离终点更近」的启发式。
 *
 * @param {{lat:number,lng:number,heading?:number}} vehicle 当前车辆坐标（可选带 heading）
 * @param {{lat:number,lng:number}|null} prevVehicle 上一时刻位置（可选）
 * @param {Array} polyline 线路走向坐标（支持 [{lat,lng}] 和 [[lng,lat],...] 两种格式）
 * @returns {{direction:number|null, confidence:number}}
 */
export function estimateDirection(vehicle, prevVehicle, polyline) {
  if (!vehicle || !polyline || polyline.length < 3) return { direction: null, confidence: 0 }
  // 统一成 [{lat,lng}] 格式
  const segs = Array.isArray(polyline[0]) && typeof polyline[0][0] === 'number'
    ? polyline.map(([lng, lat]) => ({ lat, lng }))
    : polyline

  // 车辆运动向量：优先用 heading（真北朝向），无则用位移
  let vHeading = null
  if (typeof vehicle.heading === 'number') {
    vHeading = vehicle.heading
  } else if (prevVehicle) {
    vHeading = heading(prevVehicle, vehicle)
  }
  if (vHeading === null) return { direction: null, confidence: 0 }

  // 在 polyline 上投影
  const proj = projectOnPolyline(segs, vehicle)
  if (proj.i < 0 || proj.i >= segs.length - 1) return { direction: null, confidence: 0 }

  // 段向：从 segs[i] 到 segs[i+1]
  const a = segs[proj.i]
  const b = segs[proj.i + 1]
  const sHeading = heading(a, b) // 线段朝向（度）

  // 判断：车辆朝向与线段朝向的夹角是否锐角
  const diff = angularDiffDeg(vHeading, sHeading)
  // 方向阈值：±60° 内认为同向，超过 120° 认为反向，中间模糊
  const THRESH_SAME = 60
  const THRESH_OPP = 120
  let direction = null
  let confidence = 0
  if (diff <= THRESH_SAME) {
    direction = 0 // 同向
    confidence = 1 - diff / THRESH_SAME // 0~1
  } else if (diff >= THRESH_OPP) {
    direction = 1 // 反向
    confidence = (diff - THRESH_OPP) / (180 - THRESH_OPP)
  } else {
    // 模糊区：置信度低，让调用方拿不准就降级
    direction = null
    confidence = 1 - (diff - THRESH_SAME) / (THRESH_OPP - THRESH_SAME)
  }
  return { direction, confidence }
}

export default { estimateDirection, heading, projectOnPolyline }
