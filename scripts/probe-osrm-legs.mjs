/**
 * OSRM 分段质量诊断：打印 337 路每个「站→站」leg 的规划距离与直线距离之比
 * 用途：判断"绕路兜底"阈值是否合理、坐标系是否需要纠偏
 * 用法：node scripts/probe-osrm-legs.mjs [线路号] [方向]
 */
const LINE_NO = process.argv[2] || '337'
const DIR = Number(process.argv[3] || 0)
const CITY = '420100'

// ---- GCJ-02 → WGS84（与 src/utils/geo.js 同算法）----
function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0
  const ee = 0.00669342162296594323
  const pi = Math.PI
  const outOfChina = (lon, la) => lon < 72.004 || lon > 137.8347 || la < 0.8293 || la > 55.8271
  const tLat = (x, y) => {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    ret += ((20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0) / 3.0
    ret += ((20.0 * Math.sin(y * pi) + 40.0 * Math.sin((y / 3.0) * pi)) * 2.0) / 3.0
    ret += ((160.0 * Math.sin((y / 12.0) * pi) + 320 * Math.sin((y * pi) / 30.0)) * 2.0) / 3.0
    return ret
  }
  const tLng = (x, y) => {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    ret += ((20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0) / 3.0
    ret += ((20.0 * Math.sin(x * pi) + 40.0 * Math.sin((x / 3.0) * pi)) * 2.0) / 3.0
    ret += ((150.0 * Math.sin((x / 12.0) * pi) + 300.0 * Math.sin((x / 30.0) * pi)) * 2.0) / 3.0
    return ret
  }
  if (outOfChina(lng, lat)) return { lat, lng }
  let dLat = tLat(lng - 105.0, lat - 35.0)
  let dLng = tLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * pi
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * pi)
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * pi)
  return { lat: lat + dLat, lng: lng + dLng }
}
function gcj02ToWgs84(lat, lng) {
  let wLat = lat
  let wLng = lng
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(wLat, wLng)
    wLat += lat - g.lat
    wLng += lng - g.lng
  }
  return { lat: wLat, lng: wLng }
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 与 src/utils/osrm.js 同算法：几何点偏离起终点连线的最大垂距（米）
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

// ---- 取站点 ----
async function fetchStops() {
  const body = {
    cityCode: CITY,
    xiaomaAppId: 'wx',
    appKey: 'x',
    appType: '1',
    codeType: '1',
    channelId: '1',
    appSource: '1',
    lineCode: `${CITY}-${LINE_NO}-${DIR}`,
  }
  const r = await fetch('https://customized.wuhanbus.com/gps-resapi/wechat/bus/line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', openId: 'probe-openid' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!j || j.success !== true) throw new Error('接口失败: ' + JSON.stringify(j).slice(0, 200))
  return (j.data.stopDetailList || []).map((s) => ({
    name: s.stopName,
    lat: parseFloat(s.latitude),
    lng: parseFloat(s.longitude),
  }))
}

async function osrmLegs(wgs) {
  const path = wgs.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true`
  const r = await fetch(url)
  const j = await r.json()
  if (!j || j.code !== 'Ok') throw new Error('OSRM: ' + JSON.stringify(j).slice(0, 200))
  return j.routes[0].legs || []
}

const stops = await fetchStops()
console.log('站点数:', stops.length, '方向:', DIR)
const wgs = stops.map((s) => gcj02ToWgs84(s.lat, s.lng))
const t0 = Date.now()
const legs = await osrmLegs(wgs)
console.log('OSRM 耗时:', Date.now() - t0, 'ms  legs:', legs.length)

const rows = []
legs.forEach((leg, i) => {
  const a = wgs[i]
  const b = wgs[i + 1]
  if (!a || !b) return
  const straight = haversine(a.lat, a.lng, b.lat, b.lng)
  const ratio = leg.distance / Math.max(straight, 1)
  const pts = []
  ;(leg.steps || []).forEach((st) => ((st.geometry && st.geometry.coordinates) || []).forEach(([lng, lat]) => pts.push({ lat, lng })))
  const perp = maxExcursion(pts, a, b)
  rows.push({
    i,
    from: stops[i].name,
    to: stops[i + 1].name,
    straight: Math.round(straight),
    route: Math.round(leg.distance),
    ratio: Number(ratio.toFixed(2)),
    perp: Math.round(perp),
    steps: (leg.steps || []).length,
    // 与 osrm.js 同判据：垂距超出走廊允许值即视为「画歪」
    bad: perp > Math.max(straight * 0.5, 260),
  })
})
const byRatio = [...rows].sort((x, y) => y.ratio - x.ratio)
const byIndex = [...rows].sort((x, y) => x.i - y.i)
console.log('\n逐段明细（按行驶顺序）：')
byIndex.forEach((r) => {
  console.log(
    `${String(r.i).padStart(2)} ${r.from} → ${r.to}  直线 ${r.straight}m  规划 ${r.route}m  ratio ${r.ratio}  垂距 ${r.perp}m${r.bad ? '  ❌超走廊' : ''}`
  )
})

console.log('\n比值最高的 12 段（ratio = 规划距离 / 直线距离）：')
byRatio.slice(0, 12).forEach((r) => {
  console.log(
    `${String(r.i).padStart(2)} ${r.from} → ${r.to}  直线 ${r.straight}m  规划 ${r.route}m  ratio ${r.ratio}  垂距 ${r.perp}m${r.bad ? '  ❌超走廊' : ''}`
  )
})

// 分位数：短站距（<300m）的 ratio 天然虚高，单独统计
const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.round(arr.length * p))]
const longLegs = rows.filter((r) => r.straight >= 300)
console.log('\nratio 分布：中位数', q(rows.map((r) => r.ratio), 0.5), 'P75', q(rows.map((r) => r.ratio), 0.75), 'P90', q(rows.map((r) => r.ratio), 0.9))
console.log(`站距 ≥300m 的 ${longLegs.length} 段：中位数`, q(longLegs.map((r) => r.ratio), 0.5), 'P75', q(longLegs.map((r) => r.ratio), 0.75))
console.log('被判为异常（垂距超走廊）的段数:', rows.filter((r) => r.bad).length, '/', rows.length)
const totalStraight = rows.reduce((a, r) => a + r.straight, 0)
const totalRoute = rows.reduce((a, r) => a + r.route, 0)
console.log('全线: 直线', Math.round(totalStraight), 'm  规划', Math.round(totalRoute), 'm  整体 ratio', (totalRoute / totalStraight).toFixed(2))
const kept = rows.filter((r) => !r.bad)
const ks = kept.reduce((a, r) => a + r.straight, 0)
const kr = kept.reduce((a, r) => a + r.route, 0)
console.log('剔除兜底段后: 直线', Math.round(ks), 'm  规划', Math.round(kr), 'm  ratio', (kr / Math.max(ks, 1)).toFixed(2))
