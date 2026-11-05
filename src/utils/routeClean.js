/**
 * 线路站点序列清洗 + 走向几何工具（唯一真源）
 *
 * 这个文件是「零依赖纯 ESM」：不 import 任何模块、不用 uni / window / node API，
 * 因此运行时（uni-app H5 / App）与离线脚本（Node .mjs）可以共用同一份实现。
 * 离线脚本通过 scripts/_loadRouteClean.mjs 用 data: URL 载入本文件源码（项目 package.json
 * 未声明 type:module，Node 不能直接 import src/utils/*.js），避免维护两套算法。
 *
 * 为什么需要清洗（2026-11-05 用 src/static/network.json 的 1187 个方向 / 25199 个坐标实测）：
 *   - 1616 段相邻站跳变 >1.5km（384 个方向），其中 119 段 >10km，最大 79.6km（287 路）；
 *   - 815 段连续三点大回头 >120°（32.4% 的方向）；268 段相邻站重合 <5m；
 *   - 66 个「孤立离群站」：去 >3km、回 >3km，但前后两站相距很近（221 路前后仅 20m
 *     却绕出去 3.2km）。这是上游 /line 站点坐标错误，任何贴路算法遇到都会画出巨大折返。
 * 清洗不改变站点对象结构（保留 stopId / stopName / stopNo / transferInfos），
 * 只做「过滤 / 排序 / 去重 / 剔离群」，所以 LineMap / LineStops 可零改动接入。
 */

const R = 6371000
const RAD = Math.PI / 180

/** 球面距离（米），接受 {lat,lng} */
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** 把 /line 的 stopDetailList 元素解成 { s, lat, lng }；非法坐标返回 null */
function parseStop(s) {
  if (!s) return null
  const lat = parseFloat(s.latitude)
  const lng = parseFloat(s.longitude)
  if (!isFinite(lat) || !isFinite(lng)) return null
  // 后端缺坐标回 0.0/0.0；越界值会把 bbox 拉到几内亚湾
  if (lat === 0 || lng === 0 || lat < 24 || lat > 54 || lng < 73 || lng > 135) return null
  return {
    s: { ...s, latitude: +lat.toFixed(6), longitude: +lng.toFixed(6) },
    lat,
    lng,
  }
}

/** 从清洗后的站点数组取 [{lat,lng}] */
export function pointsOf(stops) {
  return (stops || []).map((s) => ({ lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
    .filter((p) => isFinite(p.lat) && isFinite(p.lng))
}

/** 单轮剔除孤立离群点：A→B 远、B→C 远，但 A→C 很近 = B 是错误坐标 */
function dropOutliers(list, far, ratio, report) {
  if (list.length < 3) return list
  const keep = [list[0]]
  for (let i = 1; i + 1 < list.length; i++) {
    const a = list[i - 1]
    const b = list[i]
    const c = list[i + 1]
    const ab = haversine(a, b)
    const bc = haversine(b, c)
    const ac = haversine(a, c)
    if (ab > far && bc > far && ac < Math.min(ab, bc) * ratio) {
      report.outliers++
      continue // 丢弃 b，不进 keep
    }
    keep.push(b)
  }
  keep.push(list[list.length - 1])
  return keep
}

/**
 * 剔除「跳出去又跳回来」的错误簇：
 *   A →(>5km 瞬跳)→ B … C … →(回到距 A <2km 处)→ D
 * 上游偶尔把另一方向 / 另一条线的连续几个站混进列表（26 路：#0 西区 → #1#2 东区 →
 * #3 回到西区），单点离群规则抓不住「两个及以上点组成的簇」。
 * 关键约束是「必须跳回主走廊」——真实跨区线路（292 路单向 20.9km）不会跳回，
 * 因此不会被误删；中间点又必须全部远离 A，避免把渐进绕行的环线当错误。
 */
function dropExcursionClusters(list, far, back, maxSpan, report) {
  if (list.length < 3) return list
  const out = []
  let i = 0
  while (i < list.length) {
    out.push(list[i])
    if (i + 1 >= list.length) { i++; continue }
    const a = list[i]
    if (haversine(a, list[i + 1]) <= far) { i++; continue }
    let j = -1
    for (let k = i + 2; k <= Math.min(i + maxSpan, list.length - 1); k++) {
      if (haversine(a, list[k]) < back) { j = k; break }
    }
    if (j > i + 1) {
      let allFar = true
      for (let k = i + 1; k < j; k++) {
        if (haversine(a, list[k]) < back) { allFar = false; break }
      }
      if (allFar) {
        report.clusters += j - i - 1
        i = j // 跳过整簇，下一轮从「跳回点」继续
        continue
      }
    }
    i++
  }
  return out
}

/**
 * 剔除「整段坐标重复」：上游偶尔把同一段路用两套站名重复塞进一个方向。
 * 实测 909 路：站点 2–10 与 11–19 的坐标逐点完全相同（华夏理工学院东站 ↔ 凤莲大道大吴村
 * 同为 114.5905,30.3335 …），画出来就是「走过去 → 跳回来 → 再走一遍」的巨大矩形。
 * 只认「正序、相隔 ≥5 站、连续 ≥3 点重合」的重复游程，真实环线的回程是逆序重合，不会误删。
 */
function dropDuplicateRuns(list, minRun, minGap, tol, report) {
  let cur = list
  for (let guard = 0; guard < 8; guard++) {
    const n = cur.length
    let found = null
    for (let i = 0; i < n - minRun && !found; i++) {
      for (let j = i + minGap; j < n - minRun; j++) {
        let L = 0
        while (j + L < n && i + L < j && haversine(cur[i + L], cur[j + L]) < tol) L++
        if (L >= minRun) { found = { j, L }; break }
      }
    }
    if (!found || cur.length - found.L < 2) break
    report.dupRuns += found.L
    cur = cur.slice(0, found.j).concat(cur.slice(found.j + found.L))
  }
  return cur
}

/**
 * 剔除首/末端孤立错点：端点突然跳到 15km 外、且与序列里其它点都不相邻，属于上游串线。
 * 只在至少还有 3 个点时动手（2 个点的 D 线本就残缺，删了整条线就没了）；
 * 真实远郊终点会有一串渐进站点，不会只有 3 个站后瞬跳十几公里。
 */
function dropEdgeOutliers(list, far, report) {
  if (list.length < 3) return list
  const n = list.length
  if (haversine(list[n - 2], list[n - 1]) > far && haversine(list[n - 3], list[n - 1]) > far) {
    list.pop()
    report.edge++
  }
  if (list.length >= 3 && haversine(list[0], list[1]) > far && haversine(list[0], list[2]) > far) {
    list.shift()
    report.edge++
  }
  return list
}

/**
 * 清洗站点序列
 * @param {Array} raw /line 的 stopDetailList 原样数组（也接受资产里的精简数组）
 * @param {Object} opts { minGap=5(m), outlierFar=3000(m), outlierRatio=0.5, sortByNo=true }
 * @returns {{stops:Array, report:Object}} stops 保持原字段名，坐标为规范化后的数字
 */
export function cleanStops(raw, opts) {
  const o = opts || {}
  const minGap = o.minGap == null ? 5 : o.minGap
  const far = o.outlierFar == null ? 3000 : o.outlierFar
  const ratio = o.outlierRatio == null ? 0.5 : o.outlierRatio
  const report = { total: 0, invalid: 0, dups: 0, dupRuns: 0, outliers: 0, clusters: 0, edge: 0, reordered: false, maxJump: 0 }
  const src = Array.isArray(raw) ? raw : []
  report.total = src.length

  let list = []
  for (const s of src) {
    const p = parseStop(s)
    if (p) list.push(p)
    else report.invalid++
  }

  // 1) 按 stopNo 排序：仅在「全部有有效序号且确实存在逆序」时才排，
  //    避免把后端本来正确的顺序（环线 / 区间车）误改
  if (o.sortByNo !== false && list.length > 2) {
    const nos = list.map((x) => Number(x.s.stopNo))
    if (nos.every((n) => isFinite(n)) && nos.some((n, i) => i > 0 && n < nos[i - 1])) {
      const order = list.map((_, i) => i).sort((a, b) => nos[a] - nos[b])
      list = order.map((i) => list[i])
      report.reordered = true
    }
  }

  // 2) 相邻重合站点去重（保留前一个，它的 stopId / 换乘信息更完整）
  const dedup = []
  for (const p of list) {
    const last = dedup[dedup.length - 1]
    if (last && haversine(last, p) < minGap) { report.dups++; continue }
    dedup.push(p)
  }
  list = dedup

  // 3) 整段坐标重复（上游把同一段路用两套站名塞两遍，会画出巨大矩形）
  list = dropDuplicateRuns(list, 3, 5, 30, report)

  // 4) 孤立离群点剔除：做两轮，剔掉一个后可能暴露出紧邻的另一个
  list = dropOutliers(list, far, ratio, report)
  list = dropOutliers(list, far, ratio, report)

  // 5) 折返簇剔除：单点规则抓不到「两个及以上错误点连成一簇」的情况
  list = dropExcursionClusters(list, 5000, 2000, 6, report)
  list = dropOutliers(list, far, ratio, report)
  // 6) 首/末端孤立错点（末端没有后续站可「跳回」，簇规则够不到）
  list = dropEdgeOutliers(list, 15000, report)

  for (let i = 0; i + 1 < list.length; i++) {
    const d = haversine(list[i], list[i + 1])
    if (d > report.maxJump) report.maxJump = d
  }
  report.maxJump = Math.round(report.maxJump)
  return { stops: list.map((p) => p.s), report }
}

/** 几何体检：跳跃 / 回头 / 离群 / 重合，供离线回归测试与生成器统计 */
export function routeStats(pts) {
  const out = { points: (pts || []).length, jumps: 0, huge: 0, foldbacks: 0, dupPairs: 0, backs: 0, outliers: 0, dups: 0, maxJump: 0 }
  const P = (pts || []).filter((p) => isFinite(p.lat) && isFinite(p.lng))
  // 相隔 ≥5 站却落在 30m 内的坐标对 = 「同一段路被塞了两遍」的可观测指纹
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 5; j < P.length; j++) if (haversine(P[i], P[j]) < 30) out.dupPairs++
  }
  for (let i = 0; i + 1 < P.length; i++) {
    const d = haversine(P[i], P[i + 1])
    if (d > out.maxJump) out.maxJump = d
    if (d > 1500) out.jumps++
    if (d > 10000) out.huge++
    if (d < 5) out.dups++
  }
  // 折返段：瞬跳 >5km 后 6 站内又回到起点 2km 内 —— 走向图上就是「甩出去再折回来」，
  // 是用户看到的怪异折叠的直接来源。单向长跳（真实跨区线路）不计入。
  for (let i = 0; i + 1 < P.length; i++) {
    if (haversine(P[i], P[i + 1]) <= 5000) continue
    for (let k = i + 2; k <= Math.min(i + 6, P.length - 1); k++) {
      if (haversine(P[i], P[k]) < 2000) { out.foldbacks++; break }
    }
  }
  for (let i = 0; i + 2 < P.length; i++) {
    const a = P[i], b = P[i + 1], c = P[i + 2]
    const ab = haversine(a, b), bc = haversine(b, c), ac = haversine(a, c)
    if (ab > 3000 && bc > 3000 && ac < Math.min(ab, bc) * 0.5) out.outliers++
    if (ab >= 150 && bc >= 150) {
      const k = Math.cos(b.lat * RAD)
      const v1 = [(b.lng - a.lng) * k, b.lat - a.lat]
      const v2 = [(c.lng - b.lng) * k, c.lat - b.lat]
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) /
        (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1)
      if (Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI > 120) out.backs++
    }
  }
  out.maxJump = Math.round(out.maxJump)
  return out
}

/** Douglas-Peucker 抽稀（经纬度平方距离，容差单位：度） */
export function simplify(pts, tol) {
  if (!pts || pts.length < 3) return pts ? pts.slice() : []
  const perp = (p, a, b) => {
    const dx = b.lng - a.lng, dy = b.lat - a.lat
    const len2 = dx * dx + dy * dy
    if (!len2) return Math.hypot(p.lng - a.lng, p.lat - a.lat)
    let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.lng - (a.lng + t * dx), p.lat - (a.lat + t * dy))
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perp(pts[i], pts[s], pts[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx !== -1 && maxD > tol) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/**
 * 静态资产分片名：线路号 → 固定 64 个桶之一（FNV-1a）。
 * 运行时与生成器共用本函数，保证「同一条线一定落在同一个分片」；
 * 按哈希分桶而非按前缀，是为了让 D 线（546 条）均匀散开，单个分片不膨胀。
 */
export function shardOf(no) {
  const s = String(no == null ? '' : no).trim()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return 'b' + String((h >>> 0) % 64).padStart(2, '0')
}

/** 展平几何 [lng,lat,...] ↔ 运行时对象数组 */
export function toFlat(pts) {
  const out = []
  for (const p of pts || []) {
    const lat = p.lat != null ? p.lat : p.latitude
    const lng = p.lng != null ? p.lng : p.longitude
    if (!isFinite(lat) || !isFinite(lng)) continue
    out.push(+Number(lng).toFixed(6), +Number(lat).toFixed(6))
  }
  return out
}

export function fromFlat(flat) {
  const out = []
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    const lng = Number(flat[i]), lat = Number(flat[i + 1])
    if (!isFinite(lat) || !isFinite(lng)) continue
    out.push({ latitude: lat, longitude: lng })
  }
  return out
}
