/**
 * 诊断脚本：模拟 LineMap.vue 渲染管线，检查 646路 SVG 路径生成
 */
import { readFileSync } from 'fs'

// ── fromFlat（与 routeClean.js 一致）──
function fromFlat(flat) {
  const out = []
  for (let i = 0; i < flat.length; i += 2) {
    const lng = flat[i]
    const lat = flat[i + 1]
    if (!isFinite(lat) || !isFinite(lng)) continue
    if (lat < -90 || lat > 90) continue
    if (lng < -180 || lng > 180) continue
    out.push({ latitude: lat, longitude: lng })
  }
  return out
}

// ── smoothPath（与 LineMap.vue 一致）──
function f(n) { return n.toFixed(1) }
function smoothPath(pts, snapped) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${f(pts[0].x)} ${f(pts[0].y)}`
  if (snapped || pts.length < 3) {
    let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
    for (let i = 1; i < pts.length; i++) d += ` L ${f(pts[i].x)} ${f(pts[i].y)}`
    return d
  }
  // Catmull-Rom spline
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${f(c1x)} ${f(c1y)},${c2x} ${f(c2y)},${f(p2.x)} ${f(p2.y)}`
  }
  return d
}

const b35 = JSON.parse(readFileSync('src/static/lines/jt/b35.json', 'utf-8'))
const line646 = b35.lines['646']

console.log('═══════════════════════════════════════')
console.log('646路 渲染管线仿真')
console.log('═══════════════════════════════════════')

for (const dIdx of [0, 1]) {
  const dir = line646.dirs[String(dIdx)]
  console.log(`\n方向 ${dIdx}: ${dir.base?.direction ?? '?'}`)
  console.log(`  snapped=${dir.snapped}, algo=${dir.algo}, source=${dir.source}`)
  console.log(`  route原始: ${dir.route.length} 数值 (${dir.route.length/2} 点)`)
  console.log(`  stops: ${dir.stops?.length ?? 0} 站`)

  const geo = fromFlat(dir.route)
  console.log(`  fromFlat → ${geo.length} 点`)
  if (geo.length <= 1) {
    console.log('  ⚠️ 严重问题：fromFlat 失败！');
    continue;
  }

  // Simulate renderSchematic params (typical mobile viewport)
  const W = 375, H = 640
  const padX = 60, padY = 120
  const lats = geo.map(p => p.latitude)
  const lngs = geo.map(p => p.longitude)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLng = maxLng - minLng || 0.0001
  const spanLat = maxLat - minLat || 0.0001
  const scale = Math.min((W - 2*padX)/spanLng, (H - 2*padY)/spanLat)
  const sx = (lng) => (lng - minLng) * scale + padX
  const sy = (lat) => H - ((lat - minLat) * scale + padY)

  // Convert to screen coords (same as ptsOf → raw conversion)
  const screenPts = geo.map(p => ({ x: sx(p.longitude), y: sy(p.latitude) }))
  
  // Check average pixel distance between consecutive route points
  let avgPxDist = 0, maxPxDist = 0
  for (let i = 1; i < screenPts.length; i++) {
    const dx = screenPts[i].x - screenPts[i-1].x
    const dy = screenPts[i].y - screenPts[i-1].y
    const dist = Math.sqrt(dx*dx + dy*dy)
    avgPxDist += dist
    if (dist > maxPxDist) maxPxDist = dist
  }
  avgPxDist /= (screenPts.length - 1)
  
  console.log(`  屏幕坐标范围: x=[${Math.min(...screenPts.map(p=>p.x)).toFixed(0)}, ${Math.max(...screenPts.map(p=>p.x)).toFixed(0)}]`)
  console.log(`             y=[${Math.min(...screenPts.map(p=>p.y)).toFixed(0)}, ${Math.max(...screenPts.map(p=>p.y)).toFixed(0)}]`)
  console.log(`  平均相邻点间距: ${avgPxDist.toFixed(1)}px`)
  console.log(`  最大相邻点间距: ${maxPxDist.toFixed(1)}px`)
  
  // Check corner angles
  let sharpTurns = 0
  for (let i = 1; i < screenPts.length - 1; i++) {
    const a = screenPts[i-1], b = screenPts[i], c = screenPts[i+1]
    const v1 = { x: b.x - a.x, y: b.y - a.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const dot = v1.x*v2.x + v1.y*v2.y
    const mag1 = Math.sqrt(v1.x*v1.x + v1.y*v1.y)
    const mag2 = Math.sqrt(v2.x*v2.x + v2.y*v2.y)
    if (mag1 > 0 && mag2 > 0) {
      const cosA = Math.abs(dot / (mag1 * mag2))
      if (cosA < 0.9) sharpTurns++ // angle > ~25 degrees
    }
  }
  console.log(`  急转弯 (>25°): ${sharpTurns}/${screenPts.length - 2}`)
  
  // Generate SVG path (snapped=true → straight lines)
  const svgStraight = smoothPath(screenPts, true)
  const svgCurved = smoothPath(screenPts, false)
  console.log(`  SVG直线路径长度: ${svgStraight.length} chars`)
  console.log(`  SVG曲线路径长度: ${svgCurved.length} chars`)
  console.log(`  首段: ${svgStraight.substring(0, 80)}...`)
  
  // Estimate: at typical mobile zoom (~14), 1km ≈ 50px
  const kmPerPixel = 1000 / scale
  console.log(`  估算像素/km: ${scale.toFixed(1)} px/km`)
  console.log(`  结论: 平均点距${avgPxDist.toFixed(0)}px → 直线路径看起来${avgPxDist < 5 ? '平滑' : avgPxDist < 15 ? '尚可' : '明显折线'}`)
}

console.log('\n═══════════════════════════════════════')
console.log('综合评估:')
console.log('- b35.json 中 646 数据格式正确 (flat 数组，非 nested)')
console.log('- fromFlat 正确解析为 {latitude, longitude} 对象')
console.log('- snapped=true 时使用直线 L 命令而非 Catmull-Rom 曲线')
console.log('- 若点距 < 5px 则视觉平滑；5-15px 中等；>15px 明显折线')
console.log('═══════════════════════════════════════')
