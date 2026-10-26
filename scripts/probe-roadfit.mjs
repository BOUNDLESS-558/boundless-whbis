/**
 * 贴路体检 v2：把最终走向按 ~80m 加密后喂给 OSRM /match，一次拿回每个点「到最近路的距离」。
 * 直线弦的问题不在端点（端点就在站台上），而在两点之间横穿街区，所以必须加密后逐点验。
 * radiuses=35 时，离任何路都超过 35m 的点会被判为 unmatched —— 那就是「横穿街区」的铁证。
 * 用法：node scripts/probe-roadfit.mjs .openchamber/geom-337.json [加密间距米]
 */
import fs from 'node:fs'

const FILE = process.argv[2] || '.openchamber/geom-337.json'
const STEP_M = Number(process.argv[3] || 80)
const BASE = 'https://router.project-osrm.org/match/v1/driving'
const RADIUS = 30

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
function haversine(a, b) {
  const R = 6371000, tr = (d) => (d * Math.PI) / 180
  const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
// 按固定间距线性加密（经纬度线性插值在几公里尺度足够）
function densify(pts, step) {
  const out = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]
    const d = haversine(a, b)
    const n = Math.max(1, Math.round(d / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

async function matchChunk(chunk) {
  const path = chunk.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const radiuses = chunk.map(() => RADIUS).join(';')
  const url = `${BASE}/${path}?radiuses=${radiuses}&geometries=geojson&overview=false&gaps=ignore&annotations=false`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) })
      const j = await r.json()
      if (!j || j.code !== 'Ok') return { err: j && j.code }
      const tps = (j.tracepoints || []).slice()
      return { tps }
    } catch (e) {
      await new Promise((s) => setTimeout(s, 3000))
    }
  }
  return { err: 'timeout' }
}

const all = JSON.parse(fs.readFileSync(FILE, 'utf8'))
for (const [key, pts] of Object.entries(all)) {
  const dense = densify(pts, STEP_M).map((p) => gcj02ToWgs84(p.lat, p.lng))
  const dists = []
  const unmatched = []
  // 演示服务器限制：match 最多 ~10 个点、radius 不能太大（否则 RadiusTooBig）
  for (let i = 0; i < dense.length; i += 10) {
    const chunk = dense.slice(i, Math.min(i + 10, dense.length))
    if (chunk.length < 2) break
    const { tps, err } = await matchChunk(chunk)
    if (err) { console.log(`  [警告] match 失败 ${err}`); continue }
    tps.forEach((tp, k) => {
      if (!tp) { unmatched.push(i + k); return }
      dists.push(Math.round(tp.distance || 0))
    })
    await new Promise((s) => setTimeout(s, 500))
  }
  dists.sort((a, b) => a - b)
  const q = (r) => (dists.length ? dists[Math.min(dists.length - 1, Math.floor(dists.length * r))] : -1)
  console.log(`\n=== ${key}`)
  console.log(`  几何 ${pts.length} 点 → 加密到 ${dense.length} 点（每 ${STEP_M}m），可匹配 ${dists.length} 点`)
  console.log(`  离路距离 中位数 ${q(0.5)}m  P90 ${q(0.9)}m  P99 ${q(0.99)}m  最大 ${dists[dists.length - 1]}m`)
  console.log(`  贴不上路（>${RADIUS}m，即横穿街区）${unmatched.length} 点`)
  unmatched.slice(0, 15).forEach((idx) => {
    const p = dense[idx]
    console.log(`    #${idx} ${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
  })
}
