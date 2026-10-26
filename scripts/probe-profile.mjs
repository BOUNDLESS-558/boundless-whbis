/**
 * 探针：driving vs foot（OSRM walking）两套几何逐段对比，用来决定「坏段兜底该用什么」
 * 用法：node scripts/probe-profile.mjs [线路号] [方向]
 * 指标：垂距（几何偏离起终点连线的最大值，米）——越小越贴走廊
 */
const LINE_NO = process.argv[2] || '337'
const DIR = Number(process.argv[3] || 0)
const CITY = '420100'
const HOST = 'https://router.project-osrm.org/route/v1'

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
const allow = (s) => Math.max(s * 0.45, 240)
const hard = (s) => Math.max(s * 2, 1200)

async function fetchStops() {
  const r = await fetch('https://customized.wuhanbus.com/gps-resapi/wechat/bus/line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', openId: 'probe-openid' },
    body: JSON.stringify({ cityCode: CITY, lineCode: `${CITY}-${LINE_NO}-${DIR}` }),
  })
  const j = await r.json()
  if (!j || j.success !== true) throw new Error('接口失败')
  return (j.data.stopDetailList || []).map((s) => ({ name: s.stopName, lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
}

// 整条线分批请求（18 点/批），返回按站间的 leg 列表
async function plan(profile, wgs) {
  const legs = []
  for (let i = 0; i < wgs.length - 1; i += 17) {
    const seg = wgs.slice(i, Math.min(i + 18, wgs.length))
    if (seg.length < 2) break
    const path = seg.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const url = `${HOST}/${profile}/${path}?overview=full&geometries=geojson&steps=true`
    const r = await fetch(url)
    const j = await r.json()
    if (!j || j.code !== 'Ok') throw new Error(`${profile} 失败 ${JSON.stringify(j).slice(0, 120)}`)
    ;(j.routes[0].legs || []).forEach((leg) => {
      const pts = []
      ;(leg.steps || []).forEach((st) => {
        ;((st.geometry && st.geometry.coordinates) || []).forEach(([lng, lat]) => pts.push({ lat, lng }))
      })
      legs.push({ pts, distance: leg.distance || 0 })
    })
    if (i + 17 >= wgs.length - 1) break
  }
  return legs
}

const stops = await fetchStops()
const wgs = stops.map((s) => gcj02ToWgs84(s.lat, s.lng))
console.log(`线路 ${LINE_NO} 方向 ${DIR} 站点 ${stops.length}`)
const [dv, ft] = [await plan('driving', wgs), await plan('walking', wgs)]
console.log('driving legs', dv.length, ' walking legs', ft.length)

let bad = 0, fixFoot = 0, choseFoot = 0, totalD = 0, totalF = 0, totalStraight = 0
for (let i = 0; i < wgs.length - 1; i++) {
  const a = wgs[i], b = wgs[i + 1]
  const straight = haversine(a.lat, a.lng, b.lat, b.lng)
  if (straight < 30) continue
  const A = allow(straight), H = hard(straight)
  const d = dv[i], f = ft[i]
  const pd = d ? maxExcursion(d.pts, a, b) : Infinity
  const pf = f ? maxExcursion(f.pts, a, b) : Infinity
  const dBad = pd > A, fOk = pf <= A
  if (dBad) { bad++; if (fOk) fixFoot++ }
  if (dBad && fOk) choseFoot++
  const pick = d && !dBad ? d : f && fOk ? f : d && pd <= H ? d : f && pf <= H ? f : null
  if (pick) {
    totalD += (d && !dBad) || (pick === d) ? (pick === d ? d.distance : f.distance) : 0
    totalF += pick === ft[i] ? f.distance : d.distance
  }
  totalStraight += straight
  const flag = dBad ? (fOk ? '→foot✓' : '→仍坏✗') : ''
  console.log(
    `${String(i).padStart(2)} 直线${String(Math.round(straight)).padStart(4)}m  ` +
    `driving ${String(Math.round(d ? d.distance : -1)).padStart(5)}m/${String(Math.round(pd)).padStart(5)}m  ` +
    `foot ${String(Math.round(f ? f.distance : -1)).padStart(5)}m/${String(Math.round(pf)).padStart(5)}m  ${flag}  ${stops[i].name}→${stops[i + 1].name}`
  )
}
console.log(`\ndriving 超出走廊 ${bad} 段，其中 foot 能救 ${fixFoot} 段`)
const sumD = dv.reduce((s, l) => s + l.distance, 0)
const sumF = ft.reduce((s, l) => s + l.distance, 0)
console.log(`总长度：直线 ${Math.round(totalStraight)}m  driving ${Math.round(sumD)}m (${(sumD / totalStraight).toFixed(2)}x)  foot ${Math.round(sumF)}m (${(sumF / totalStraight).toFixed(2)}x)`)
