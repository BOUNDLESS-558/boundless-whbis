/**
 * 探针 C：对「被判超走廊」的段，试 alternatives（备选路线）与备用路由服务，看能否用地面道路代替直连
 * 用法：node scripts/probe-alt-routes.mjs [线路号] [方向]
 */
const LINE_NO = process.argv[2] || '337'
const DIR = Number(process.argv[3] || 0)
const HOSTS = [
  ['project-osrm', 'https://router.project-osrm.org/route/v1/driving'],
  ['fossgis', 'https://routing.openstreetmap.de/routed-car/route/v1/driving'],
]

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
function flatten(routeLeg) {
  const pts = []
  ;(routeLeg.steps || []).forEach((st) => ((st.geometry && st.geometry.coordinates) || []).forEach(([lng, lat]) => pts.push({ lat, lng })))
  return pts
}

async function stops() {
  const r = await fetch('https://customized.wuhanbus.com/gps-resapi/wechat/bus/line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', openId: 'probe-openid' },
    body: JSON.stringify({ cityCode: '420100', lineCode: `420100-${LINE_NO}-${DIR}` }),
  })
  const j = await r.json()
  if (!j || j.success !== true) throw new Error('接口失败')
  return (j.data.stopDetailList || []).map((s) => ({ name: s.stopName, lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
}

async function plan(host, wgs) {
  const legs = []
  for (let i = 0; i < wgs.length - 1; i += 17) {
    const seg = wgs.slice(i, Math.min(i + 18, wgs.length))
    if (seg.length < 2) break
    const path = seg.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const url = `${host}/${path}?overview=full&geometries=geojson&steps=true`
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const j = await r.json()
    if (!j || j.code !== 'Ok') throw new Error(JSON.stringify(j).slice(0, 120))
    ;(j.routes[0].legs || []).forEach((l) => legs.push({ pts: flatten(l), distance: l.distance || 0 }))
    if (i + 17 >= wgs.length - 1) break
    await new Promise((s) => setTimeout(s, 400))
  }
  return legs
}

async function alternatives(host, a, b) {
  const p = `${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}`
  const url = `${host}/${p}?overview=full&geometries=geojson&steps=true&alternatives=3`
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const j = await r.json()
  if (!j || j.code !== 'Ok') return []
  return (j.routes || []).map((rt) => ({ pts: flatten(rt.legs[0]), distance: rt.distance || 0 }))
}

const st = await stops()
const wgs = st.map((s) => gcj02ToWgs84(s.lat, s.lng))
console.log(`线路 ${LINE_NO} 方向 ${DIR}，${st.length} 站\n`)

for (const [name, host] of HOSTS) {
  const t0 = Date.now()
  try {
    const legs = await plan(host, wgs)
    const allowList = []
    let bad = 0
    for (let i = 0; i < wgs.length - 1; i++) {
      const straight = haversine(wgs[i].lat, wgs[i].lng, wgs[i + 1].lat, wgs[i + 1].lng)
      if (straight < 30 || !legs[i]) continue
      const allow = Math.max(straight * 0.5, 260)
      const perp = maxExcursion(legs[i].pts, wgs[i], wgs[i + 1])
      if (perp > allow) { bad++; allowList.push({ i, perp, allow }) }
    }
    const total = legs.reduce((s, l) => s + l.distance, 0)
    console.log(`[${name}] ${Date.now() - t0}ms 总长 ${(total / 1000).toFixed(2)}km 超走廊 ${bad} 段`)
    for (const { i, perp, allow } of allowList) {
      const straight = haversine(wgs[i].lat, wgs[i].lng, wgs[i + 1].lat, wgs[i + 1].lng)
      const alts = await alternatives(host, wgs[i], wgs[i + 1])
      const scored = alts.map((a) => {
        const p = maxExcursion(a.pts, wgs[i], wgs[i + 1])
        return `${Math.round(p)}m/${(a.distance / 1000).toFixed(2)}km${p <= allow ? '✓' : ''}`
      })
      console.log(
        `   段${String(i).padStart(2)} 直线${String(Math.round(straight)).padStart(4)}m 走廊${Math.round(allow)}m 默认${Math.round(perp)}m ` +
        `备选[${scored.join(', ')}]  ${st[i].name}→${st[i + 1].name}`
      )
      await new Promise((s) => setTimeout(s, 350))
    }
  } catch (e) {
    console.log(`[${name}] 失败: ${e.message.slice(0, 140)}`)
  }
}
