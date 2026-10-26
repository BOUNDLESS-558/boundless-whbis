/**
 * 探针 A：高德 SSR 线路详情页允许被第三方页面 iframe 嵌套吗（XFO / CSP frame-ancestors）
 * 探针 B：OSRM 加 exclude=motorway 能否让「被吸附到高架」的段回到地面道路
 * 用法：node scripts/probe-embed-and-exclude.mjs [线路号] [方向]
 */
const LINE_NO = process.argv[2] || '337'
const DIR = Number(process.argv[3] || 0)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

// ---------- A：能否被 iframe 嵌套 ----------
const kw = encodeURIComponent(LINE_NO + '路')
const ssr =
  `https://www.amap.com/ssr/search/busline_detail?query_type=TQUERY&query=${kw}&city=420100` +
  `&geoobj=114.183559%7C30.498013%7C114.523448%7C30.679478&zoom=12&busId=900000128833&keywords=${kw}&key_name=${kw}`
for (const [name, url] of [
  ['SSR 线路详情页', ssr],
  ['amap 首页', 'https://www.amap.com/'],
]) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    console.log(`[A] ${name}`)
    console.log('    status', r.status, 'ctype', r.headers.get('content-type'))
    console.log('    X-Frame-Options      :', r.headers.get('x-frame-options') || '(无)')
    console.log('    CSP(frames)          :', r.headers.get('content-security-policy') || '(无)')
    console.log('    CSP-Report-Only      :', r.headers.get('content-security-policy-report-only') || '(无)')
    console.log('    坐标字段 xs/ys 是否在 HTML 里:', /"xs"|"ys"|polyline/.test(await r.text()) ? '有' : '无（只有 SPA 外壳）')
  } catch (e) {
    console.log(`[A] ${name} 失败`, e.message)
  }
}

// ---------- B：exclude=motorway ----------
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
  if (!j || j.success !== true) throw new Error('接口失败')
  return (j.data.stopDetailList || []).map((s) => ({ name: s.stopName, lat: parseFloat(s.latitude), lng: parseFloat(s.longitude) }))
}

async function plan(wgs, extraQuery) {
  const legs = []
  for (let i = 0; i < wgs.length - 1; i += 17) {
    const seg = wgs.slice(i, Math.min(i + 18, wgs.length))
    if (seg.length < 2) break
    const path = seg.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true${extraQuery}`
    const r = await fetch(url)
    const j = await r.json()
    if (!j || j.code !== 'Ok') throw new Error('OSRM 失败: ' + JSON.stringify(j).slice(0, 160))
    ;(j.routes[0].legs || []).forEach((leg) => {
      const pts = []
      ;(leg.steps || []).forEach((st) => ((st.geometry && st.geometry.coordinates) || []).forEach(([lng, lat]) => pts.push({ lat, lng })))
      legs.push({ pts, distance: leg.distance || 0 })
    })
    if (i + 17 >= wgs.length - 1) break
  }
  return legs
}

const st = await stops()
const wgs = st.map((s) => gcj02ToWgs84(s.lat, s.lng))
const base = await plan(wgs, '')
let ex = null
try {
  ex = await plan(wgs, '&exclude=motorway')
} catch (e) {
  console.log('[B] exclude=motorway 请求失败:', e.message.slice(0, 160))
}

console.log(`\n[B] ${LINE_NO} 路 方向 ${DIR}：逐段「垂距」对比（越小越贴走廊）`)
let badBase = 0, badEx = 0, fixed = 0
for (let i = 0; i < wgs.length - 1; i++) {
  const a = wgs[i], b = wgs[i + 1]
  const straight = haversine(a.lat, a.lng, b.lat, b.lng)
  if (straight < 30) continue
  const allow = Math.max(straight * 0.5, 260)
  const p0 = maxExcursion(base[i] && base[i].pts, a, b)
  const p1 = ex && ex[i] ? maxExcursion(ex[i].pts, a, b) : null
  const b0 = p0 > allow, b1 = p1 != null && p1 > allow
  if (b0) badBase++
  if (p1 != null && b1) badEx++
  if (b0 && p1 != null && !b1) fixed++
  const mark = b0 ? (p1 != null && !b1 ? '  →exclude 修好 ✓' : '  →仍超 ✗') : ''
  console.log(
    `${String(i).padStart(2)} 直线 ${String(Math.round(straight)).padStart(4)}m  默认 ${String(Math.round(p0)).padStart(5)}m` +
    `  exclude ${p1 == null ? '  --' : String(Math.round(p1)).padStart(5) + 'm'}${mark}  ${st[i].name}→${st[i + 1].name}`
  )
}
console.log(`\n默认超走廊 ${badBase} 段；exclude=motorway 超走廊 ${badEx} 段；修复 ${fixed} 段`)
