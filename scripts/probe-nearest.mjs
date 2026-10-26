/**
 * 探针 D：坏段的病根是不是「端点被吸附到高架层」？
 * 用 OSRM /nearest?number=3 列出每个端点最近的 3 条道路（含 name），再对候选点两两规划，
 * 看是否存在「地面-地面」组合能把 9.51km 的荒唐绕行压回 600m。
 * 用法：node scripts/probe-nearest.mjs [线路号] [方向]
 */
const LINE_NO = process.argv[2] || '337'
const DIR = Number(process.argv[3] || 0)
const BASE = 'https://router.project-osrm.org'

function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323, pi = Math.PI
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
  let wLat = lat, wLng = lng
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(wLat, wLng)
    wLat += lat - g.lat
    wLng += lng - g.lng
  }
  return { lat: wLat, lng: wLng }
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
function toMeters(p, lat0, lng0) {
  return { x: (p.lng - lng0) * 111320 * Math.cos((lat0 * Math.PI) / 180), y: (p.lat - lat0) * 110540 }
}
function maxExcursion(pts, a, b) {
  if (!pts || pts.length < 2) return Infinity
  const lat0 = (a.lat + b.lat) / 2, lng0 = (a.lng + b.lng) / 2
  const A = toMeters(a, lat0, lng0), B = toMeters(b, lat0, lng0)
  const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy
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

async function stops() {
  const r = await fetch('https://customized.wuhanbus.com/gps-resapi/wechat/bus/line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', openId: 'probe-openid' },
    body: JSON.stringify({ cityCode: '420100', lineCode: `420100-${LINE_NO}-${DIR}` }),
  })
  const j = await r.json()
  return (j.data.stopDetailList || []).map((s) => ({ name: s.stopName, lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
}

async function nearest(p) {
  const url = `${BASE}/nearest/v1/driving/${p.lng.toFixed(6)},${p.lat.toFixed(6)}?number=3`
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const j = await r.json()
  if (!j || j.code !== 'Ok') return []
  return (j.waypoints || []).map((w) => ({
    name: w.name || '(无名)',
    dist: Math.round(w.distance || 0),
    lng: w.location[0],
    lat: w.location[1],
  }))
}

async function route(a, b) {
  const p = `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}`
  const url = `${BASE}/route/v1/driving/${p}?overview=full&geometries=geojson&steps=true`
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const j = await r.json()
  if (!j || j.code !== 'Ok') return null
  const rt = j.routes[0]
  const pts = []
  ;(rt.legs[0].steps || []).forEach((st) => ((st.geometry && st.geometry.coordinates) || []).forEach(([lng, lat]) => pts.push({ lat, lng })))
  return { pts, distance: rt.distance || 0 }
}

const BAD = [5, 6, 7, 8, 21, 23]
const st = await stops()
const wgs = st.map((s) => gcj02ToWgs84(s.lat, s.lng))

for (const i of BAD) {
  const a = wgs[i], b = wgs[i + 1]
  const straight = haversine(a.lat, a.lng, b.lat, b.lng)
  const allow = Math.max(straight * 0.5, 260)
  console.log(`\n=== 段${i} 直线 ${Math.round(straight)}m 走廊 ${Math.round(allow)}m  ${st[i].name} → ${st[i + 1].name}`)
  const na = await nearest(a)
  const nb = await nearest(b)
  console.log(`  A 端点候选: ${na.map((c) => `${c.name}(${c.dist}m)`).join(' | ')}`)
  console.log(`  B 端点候选: ${nb.map((c) => `${c.name}(${c.dist}m)`).join(' | ')}`)
  let best = null
  for (let x = 0; x < na.length; x++) {
    for (let y = 0; y < nb.length; y++) {
      await new Promise((s) => setTimeout(s, 300))
      const rr = await route(na[x], nb[y])
      if (!rr) continue
      const perp = maxExcursion(rr.pts, a, b)
      const ok = perp <= allow
      console.log(
        `    A#${x}${na[x].name} → B#${y}${nb[y].name}: 长 ${(rr.distance / 1000).toFixed(2)}km 垂距 ${Math.round(perp)}m${ok ? '  ✓可用' : ''}`
      )
      const score = ok ? rr.distance : rr.distance + perp * 20
      if (!best || score < best.score) best = { score, x, y, ok, rr, perp }
    }
  }
  if (best) console.log(`  → 选择 A#${best.x} B#${best.y} ${(best.rr.distance / 1000).toFixed(2)}km 垂距 ${Math.round(best.perp)}m`)
}
