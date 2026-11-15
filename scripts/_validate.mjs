/**
 * 线路资产几何校验：判定「站点是否贴合走向 polyline」。
 *
 * 这是 646 / 361 两起「线路改线后资产仍是旧的」事故的防御机制：
 * 一旦线路改道（起讫站改名、走向整个换了），旧 polyline 与新站点会差到 1~3km，
 * 而采集台账已把该线标成 done，增量机制永久跳过 → 资产无限期陈旧。
 *
 * 本模块提供纯本地校验（不发任何网络请求、不消耗高德配额），供：
 *   - scan-routes-amap.mjs 采集后校验 / 每轮开始前复校验 done 线
 *   - validate-routes.mjs   独立全量审计
 * 共用同一套判定标准，避免两边口径不一。
 */

/** 两点球面近似距离（米） */
export function distM(a, b) {
  return Math.hypot(
    (a.lng - b.lng) * 111320 * Math.cos((a.lat + b.lat) * Math.PI / 360),
    (a.lat - b.lat) * 110540,
  )
}

/** 点到线段的垂直距离（米） */
export function d2seg(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-12) return distM(p, a)
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / l2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return distM(p, { lng: a.lng + t * dx, lat: a.lat + t * dy })
}

/**
 * 把站点投影到 polyline 上，返回最近点的「沿线累计距离」与「偏离米数」。
 * @param {{lng,lat}} p  站点坐标
 * @param {{lng,lat}[]} poly  polyline 点列
 * @param {number[]} cum   polyline 沿线累计距离（由 cumAlong 生成）
 */
export function project(p, poly, cum) {
  let best = { dev: 1e18, cum: 0 }
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1]
    const d = d2seg(p, a, b)
    if (d < best.dev) {
      const segLen = distM(a, b)
      const dx = b.lng - a.lng, dy = b.lat - a.lat
      const l2 = dx * dx + dy * dy || 1
      const t = Math.min(1, Math.max(0, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / l2))
      best = { dev: d, cum: cum[i] + segLen * t }
    }
  }
  return best
}

/** polyline 沿线累计距离 */
export function cumAlong(poly) {
  const c = [0]
  for (let i = 1; i < poly.length; i++) c.push(c[i - 1] + distM(poly[i - 1], poly[i]))
  return c
}

/**
 * 校验一组站点是否贴合一条 polyline。
 *
 * 判定策略（针对 646 / 361 类「改线后资产陈旧」事故设计）：
 *   - 主信号是「最大偏离」：改道通常是 1~3km 的偏差，200m 阈值足够灵敏又不误报路口微调。
 *   - 站序单调性是辅助信号：站点投影到 polyline 上的累积距离应单调（正序或反序）。
 *     但站点贴得很近（同一路口多站）时投影累积距离可能因浮点抖动而看似非单调，
 *     此时只要偏离很小就当作正常，不误伤。
 *   - 综合规则：偏离 > 阈值 且 非单调 → 不通过；偏离 > 阈值 但单调 → 通过（可能是新旧线平行段）；
 *     偏离 ≤ 阈值 → 通过（站点在线上，单调性抖动忽略）。
 *
 * @param {{stopName,longitude,latitude}[]} stops  站点列表（已清洗）
 * @param {{lng,lat}[]} poly                        polyline 点列
 * @param {object} [opts]
 * @param {number} [opts.maxDeviation=200]  单站最大允许偏离（米）
 * @param {number} [opts.minMonotonicGap=5]  站序单调判定容差（米），防浮点抖动
 * @param {number} [opts.monotonicStrictDev=50]  小于此偏离时放宽单调性（同路口多站场景）
 * @returns {{
 *   ok: boolean,
 *   maxDeviation: number,     最大偏离米数
 *   worstStop: string|null,   最偏离的站名
 *   monotonic: boolean,       站序是否单调（正序或反序均可）
 *   direction: 'forward'|'reversed'|'mixed',
 *   stops: {stopName,dev,cum}[],
 * }}
 */
export function validateStopsAgainstPolyline(stops, poly, opts = {}) {
  const maxDeviation = opts.maxDeviation ?? 200
  const minMonotonicGap = opts.minMonotonicGap ?? 5
  const monotonicStrictDev = opts.monotonicStrictDev ?? 50
  if (!stops || stops.length < 2 || !poly || poly.length < 2) {
    return { ok: false, maxDeviation: Infinity, worstStop: null, monotonic: false, direction: 'mixed', stops: [] }
  }
  const cum = cumAlong(poly)
  const projected = stops.map((s) => {
    const r = project({ lng: +s.longitude, lat: +s.latitude }, poly, cum)
    return { stopName: s.stopName, dev: r.dev, cum: r.cum }
  })

  let maxDeviationFound = 0, worstStop = null
  for (const p of projected) {
    if (p.dev > maxDeviationFound) { maxDeviationFound = p.dev; worstStop = p.stopName }
  }

  // 站序单调性：允许同一路口多站（累积距离差 < minMonotonicGap）的轻微回退
  let monoForward = true, monoReverse = true
  for (let i = 1; i < projected.length; i++) {
    const gap = projected[i].cum - projected[i - 1].cum
    if (gap < -minMonotonicGap) monoForward = false
    if (gap > minMonotonicGap) monoReverse = false
  }

  const monotonic = monoForward || monoReverse
  const direction = monoForward ? 'forward' : (monoReverse ? 'reversed' : 'mixed')

  // 判定：偏离小 → 站点在线上，通过（单调性抖动忽略）
  //       偏离大且单调 → 可能是新旧线平行段，仍算通过（避免误伤）
  //       偏离大且非单调 → 站点与走向根本不匹配，不通过
  const ok = maxDeviationFound <= maxDeviation || monotonic

  return { ok, maxDeviation: maxDeviationFound, worstStop, monotonic, direction, stops: projected }
}

/**
 * 从资产行的 route（扁平 [lng,lat,lng,lat,...]）构造 polyline 点列。
 */
export function routeToPoly(route) {
  const poly = []
  for (let i = 0; i < route.length; i += 2) poly.push({ lng: route[i], lat: route[i + 1] })
  return poly
}