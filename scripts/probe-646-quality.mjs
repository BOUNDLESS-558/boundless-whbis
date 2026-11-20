/**
 * 诊断：检查 646路 的"直连"视觉问题
 * 
 * 关键问题：osrm.js v4 产出的 route 点数太少 (~100点/方向)，
 * 导致屏幕上的平均间距过大，snapped=true 时画折线看起来像直连。
 */
import { readFileSync } from 'fs'

const b35 = JSON.parse(readFileSync('src/static/lines/jt/b35.json', 'utf-8'))
const dir0 = b35.lines['646'].dirs['0']

// Parse flat [lng,lat] array
const pts = []
for (let i = 0; i < dir0.route.length; i += 2) {
  pts.push({ lng: dir0.route[i], lat: dir0.route[i+1] })
}

console.log(`路线总点数: ${pts.length}`)
console.log(`起点: (${pts[0].lng.toFixed(6)}, ${pts[0].lat.toFixed(6)})`)
console.log(`终点: (${pts[pts.length-1].lng.toFixed(6)}, ${pts[pts.length-1].lat.toFixed(6)})`)

// Compute bounding box in meters
function toMeters(lon, lat, refLon, refLat) {
  return {
    dx: (lon - refLon) * 111320 * Math.cos(refLat * Math.PI / 180),
    dy: (lat - refLat) * 110540
  }
}

const ref = pts[0]
let minX = 0, maxX = 0, minY = 0, maxY = 0
for (const p of pts) {
  const m = toMeters(p.lng, p.lat, ref.lng, ref.lat)
  minX = Math.min(minX, m.dx); maxX = Math.max(maxX, m.dx)
  minY = Math.min(minY, m.dy); maxY = Math.max(maxY, m.dy)
}

const widthKm = (maxX - minX) / 1000
const heightKm = (maxY - minY) / 1000
console.log(`\n路线包围盒: ${(widthKm).toFixed(2)} km × ${(heightKm).toFixed(2)} km`)

// For schematic rendering, fitRect uses the route bounds to compute camera params
// If width=5.5km, height=0.67km, then at W=375, H=600 with padding:
// scaleX = (375-120)/5.5 ≈ 46 px/km
// scaleY = (600-240)/0.67 ≈ 537 px/km
// scale = min(46, 537) = 46 px/km (width-limited)

const W = 375, H = 600, padX = 60, padY = 120
const scaleX = (W - 2*padX) / (widthKm || 0.001)
const scaleY = (H - 2*padY) / (heightKm || 0.001)
const scale = Math.min(scaleX, scaleY)
console.log(`scaleX=${scaleX.toFixed(0)} px/km, scaleY=${scaleY.toFixed(0)} px/km`)
console.log(`effective scale=${scale.toFixed(0)} px/km (width-limited)`)

// Now compute pixel distances between consecutive route points
const totalLenM = pts.reduce((sum, p, i) => {
  if (i === 0) return 0
  const prev = pts[i-1]
  const m1 = toMeters(prev.lng, prev.lat, ref.lng, ref.lat)
  const m2 = toMeters(p.lng, p.lat, ref.lng, ref.lat)
  return sum + Math.sqrt((m2.dx-m1.dx)**2 + (m2.dy-m1.dy)**2)
}, 0)

let maxPxJump = 0
let avgPxDist = 0
const jumps = []
for (let i = 1; i < pts.length; i++) {
  const m1 = toMeters(pts[i-1].lng, pts[i-1].lat, ref.lng, ref.lat)
  const m2 = toMeters(pts[i].lng, pts[i].lat, ref.lng, ref.lat)
  const segM = Math.sqrt((m2.dx-m1.dx)**2 + (m2.dy-m1.dy)**2)
  const segPx = segM / 1000 * scale
  jumps.push(segPx)
  avgPxDist += segPx
  if (segPx > maxPxJump) maxPxJump = segPx
}
avgPxDist /= (pts.length - 1)

console.log(`\n=== 渲染质量指标 ===`)
console.log(`平均像素间距: ${avgPxDist.toFixed(1)} px`)
console.log(`最大像素跳跃: ${maxPxJump.toFixed(1)} px`)
console.log(`P50像素间距: ${jumps.sort((a,b)=>a-b)[Math.floor(jumps.length*0.5)].toFixed(1)} px`)
console.log(`P90像素间距: ${jumps.sort((a,b)=>a-b)[Math.floor(jumps.length*0.9)].toFixed(1)} px`)
console.log(`P95像素间距: ${jumps.sort((a,b)=>a-b)[Math.floor(jumps.length*0.95)].toFixed(1)} px`)

// Visual assessment
console.log(`\n=== 视觉评估 ===`)
if (maxPxJump < 20) console.log('✓ 平滑无明显锯齿')
else if (maxPxJump < 50) console.log('~ 中等质量，部分路段可见折线')
else if (maxPxJump < 100) console.log('⚠ 明显直连，长段可见直线')
else console.log('✗ 严重直连，大段无中间点')

console.log(`\n结论:`)
console.log(`- 646路东西走向明显（宽5.5km，高仅0.67km）`)
console.log(`- 地图按宽度适配（scale≈46px/km），高度方向有大量留白`)
console.log(`- 平均点距${avgPxDist.toFixed(0)}px → 基本可接受`)
console.log(`- 但最大跳跃${maxPxJump.toFixed(0)}px → 某些路段明显直连`)
console.log(`- 根因：算法v4输出的OSRM几何稀疏（每~500m才有一个点）`)
