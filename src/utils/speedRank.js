/**
 * 车速榜：对「全市快照」里的车辆按 gpsSpeed 从高到低排序，取前 N 名。
 *
 * 纯函数、零网络请求：数据源是 cityBus.sweepCity() 已经拉好的 cityBuses +
 * 本地静态线路索引 lines.json，榜单只是本地排序 + 字段补全 + 切片。
 *
 * 注意：这里**不判定超速**——接口没有限速值/道路等级，无法判断某辆车是否违章。
 * 只呈现「当前快照里车速最高的 N 台车」，名次纯粹由 gpsSpeed 决定。
 */
import { findLine } from './lineIndex.js'

/** 营运公司中文序号（与车辆详情窗同源，全站统一口径） */
export const CN_ORG = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']

/**
 * 所属营运公司：由车辆自编号首位推断（1 → 武汉公交集团第一公司）。
 * 与「车辆详情窗 / 控制卡徽标」共用同一个函数，避免两处口径漂移。
 */
export function orgCompanyOf(b) {
  const d = String((b && b.orgId) || '').charAt(0)
  return d >= '1' && d <= '9' ? `武汉公交集团${CN_ORG[Number(d)]}公司` : '未知公司'
}

// 起讫站查询缓存：一次榜单 50 行、同一条线常常出现多辆车，避免重复遍历索引
const ROUTE_CACHE = new Map()

/**
 * 车辆走向（起点站开往终点站）。
 * lines.json 里的 start/end 是上行（dir=0）口径；下行要整体反转，
 * 否则下行车辆会显示成「从上行起点出发」，方向是错的。
 * @returns {{from:string, to:string, text:string, known:boolean}}
 */
export function routeOf(no, dir) {
  const key = `${no}|${dir}`
  if (ROUTE_CACHE.has(key)) return ROUTE_CACHE.get(key)
  const l = findLine(no)
  let from = (l && l.start) || ''
  let to = (l && l.end) || ''
  if (Number(dir) === 1) {
    const t = from
    from = to
    to = t
  }
  const r = {
    from,
    to,
    text: from && to ? `${from} → ${to}` : (from || to || ''),
    known: !!(from && to),
  }
  ROUTE_CACHE.set(key, r)
  return r
}

/** 可选档位（用户可自由切换） */
export const RANK_LIMITS = [10, 20, 50]
export const DEFAULT_RANK_LIMIT = 20

/**
 * GPS 漂移阈值：超过这个速度基本不可能是公交运营速度（实测全市样本 0~48 km/h）。
 * 不做剔除（用户要的是「车速最高的前 N 名」），只打一个标记让 UI 提示「疑似漂移」，
 * 避免个别脏数据被当成真实成绩。想看原始值也仍然排在榜上。
 */
export const DRIFT_SPEED = 80

/**
 * 生成榜单。
 * @param {Array<Object>} buses 全市快照车辆（cityBuses）
 * @param {number} limit 取前 N 名
 * @returns {{ rows: Array<Object>, total: number, driftCount: number, hasData: boolean }}
 */
export function rankBySpeed(buses, limit = DEFAULT_RANK_LIMIT) {
  const list = Array.isArray(buses) ? buses : []
  const n = RANK_LIMITS.includes(Number(limit)) ? Number(limit) : DEFAULT_RANK_LIMIT

  // 同一 busId 在快照里已去重；这里再兜一层，防止外部传入未去重数组
  const seen = new Set()
  const scored = []
  list.forEach((b) => {
    if (!b || !b.busId || seen.has(b.busId)) return
    const speed = Number(b.gpsSpeed != null ? b.gpsSpeed : b.speed)
    if (!isFinite(speed) || speed < 0) return
    seen.add(b.busId)
    scored.push({ bus: b, speed })
  })

  // 速度降序；同速时 GPS 时间新者优先、再按 busId 稳定兜底，避免每次重排抖动
  scored.sort((a, b) => {
    if (b.speed !== a.speed) return b.speed - a.speed
    const ta = String(a.bus.time || '')
    const tb = String(b.bus.time || '')
    if (ta !== tb) return tb > ta ? 1 : -1
    return String(a.bus.busId) < String(b.bus.busId) ? -1 : 1
  })

  const rows = scored.slice(0, n).map((x, i) => {
    const b = x.bus
    const rt = routeOf(b.no, b.dir)
    return {
      rank: i + 1,
      speed: x.speed,
      bus: b,
      no: b.no,
      lineName: b.lineName || '',
      dir: b.dir,
      orgId: b.orgId || '',
      busId: b.busId,
      time: b.time || '',
      arrived: b.arrived,
      lat: b.lat,
      lng: b.lng,
      band: typeof b.band === 'number' ? b.band : 0,
      drift: x.speed > DRIFT_SPEED,
      // 所属营运公司（与车辆详情窗同一口径）
      company: orgCompanyOf(b),
      // 走向：起点站开往终点站（下行已反转）
      from: rt.from,
      to: rt.to,
      routeText: rt.known ? rt.text : (b.lineName || '走向未知'),
      routeKnown: rt.known,
    }
  })

  return {
    rows,
    total: scored.length,
    driftCount: scored.filter((x) => x.speed > DRIFT_SPEED).length,
    hasData: scored.length > 0,
  }
}
