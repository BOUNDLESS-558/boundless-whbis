/**
 * 探针 D：坏段的病根是不是「端点被吸附到高架层」？
 * 用 OSRM /nearest?number=3 列出每个端点最近的 3 条道路（含 name），再对候选点两两规划，
 * 看是否存在「地面-地面」组合能把 9.51km 的荒唐绕行压回 600m。
 * 用法：node scripts/probe-nearest.mjs [线路号] [方向]
 */
import { wgs84ToGcj02, gcj02ToWgs84, haversine, toMeters, maxExcursion } from './_geo.mjs'

const LINE_NO = process.argv[2] || '337'
const DIR = Number(process.argv[3] || 0)
const BASE = 'https://router.project-osrm.org'

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
  const straight = haversine(a, b)
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
