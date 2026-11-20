/**
 * 诊断：对比 sideShift 对 screen-coords vs lat/lng coords 的差异
 */
import { readFileSync } from 'fs'

function fromFlat(flat) {
  const out = []
  for (let i = 0; i < flat.length; i += 2) {
    const lng = flat[i], lat = flat[i+1]
    if (!isFinite(lat)||!isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180) continue
    out.push({ latitude: lat, longitude: lng })
  }
  return out
}

const b35 = JSON.parse(readFileSync('src/static/lines/jt/b35.json', 'utf-8'))
const dir0 = b35.lines['646'].dirs['0']
const geo0 = fromFlat(dir0.route)

console.log(`routeByDir[0]: ${geo0.length} points`)
console.log(`first: (${geo0[0].latitude.toFixed(6)}, ${geo0[0].longitude.toFixed(6)})`)
console.log(`last: (${geo0[geo0.length-1].latitude.toFixed(6)}, ${geo0[geo0.length-1].longitude.toFixed(6)})`)

// Simulate ptsOf: convert to {lat, lng} (screen-coord-like object)
const src = geo0.map(p => ({ lat: p.latitude, lng: p.longitude }))

// Simulate toScreen with typical parameters
const W = 375, H = 600
const padX = 60, padY = 120
const minLat = Math.min(...src.map(p=>p.lat))
const maxLat = Math.max(...src.map(p=>p.lat))
const minLng = Math.min(...src.map(p=>p.lng))
const maxLng = Math.max(...src.map(p=>p.lng))
const spanLng = maxLng - minLng || 0.001
const spanLat = maxLat - minLat || 0.001
const scaleX = (W - 2*padX) / spanLng
const scaleY = (H - 2*padY) / spanLat
const scale = Math.min(scaleX, scaleY)
const sx = (lng) => (lng - minLng) * scale + padX
const sy = (lat) => H - ((lat - minLat) * scale + padY)

// Convert to screen coords
const screenPts = src.map(p => ({ x: sx(p.lng), y: sy(p.lat) }))
console.log(`\nScreen coords range:`)
console.log(`  x: [${Math.min(...screenPts.map(p=>p.x)).toFixed(0)}, ${Math.max(...screenPts.map(p=>p.x)).toFixed(0)}]`)
console.log(`  y: [${Math.min(...screenPts.map(p=>p.y)).toFixed(0)}, ${Math.max(...screenPts.map(p=>p.y)).toFixed(0)}]`)

// Now apply offset to screen coords (what LineMap.vue does)
// sideShift(screenPts, trackOff=3.5): computes perp offset using lat/lng interpretation
function sideShiftWrong(pts, m) {
  return pts.map((p, i) => {
    const pP = pts[i-1] || p, pN = pts[i+1] || p
    // BUG: pP.latitude is actually pP.x (screen coord), pP.longitude is pP.y (screen coord)
    const dx = pN.longitude - pP.longitude  // = pN.y - pP.y (SCREEN Y diff!)
    const dy = pN.latitude - pP.latitude    // = pN.x - pP.x (SCREEN X diff!)
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x - (dy / len) * m, y: p.y + (dx / len) * m }
  })
}

// Correct version: interpret as screen coords
function sideShiftCorrect(pts, m) {
  return pts.map((p, i) => {
    const pP = pts[i-1] || p, pN = pts[i+1] || p
    const dx = pN.x - pP.x   // SCREEN X diff
    const dy = pN.y - pP.y   // SCREEN Y diff
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x - (dy / len) * m, y: p.y + (dx / len) * m }
  })
}

const wrongOff = sideShiftWrong(screenPts, 3.5)
const correctOff = sideShiftCorrect(screenPts, 3.5)

// Check max deviation between wrong and correct
let maxDev = 0
for (let i = 0; i < screenPts.length; i++) {
  const dev = Math.hypot(wrongOff[i].x - correctOff[i].x, wrongOff[i].y - correctOff[i].y)
  if (dev > maxDev) maxDev = dev
}
console.log(`\nsideShift偏差分析:`)
console.log(`  错误解读(x作为lat, y作为lng) vs 正确解读的最大偏差: ${maxDev.toFixed(2)} px`)

// Also check: what does the WRONG offset look like for horizontal vs vertical segments?
console.log(`\n具体案例（某段水平方向路线）:`)
for (let i = 1; i < screenPts.length - 1; i++) {
  const pP = screenPts[i-1], p = screenPts[i], pN = screenPts[i+1]
  // Horizontal-ish segment: dy small, dx large
  if (Math.abs(pN.y - pP.y) < 2 && Math.abs(pN.x - pP.x) > 10) {
    console.log(`  点${i}: screen(${p.x.toFixed(0)}, ${p.y.toFixed(0)}), 水平段dy=${(pN.y-pP.y).toFixed(1)}, dx=${(pN.x-pP.x).toFixed(0)}`)
    console.log(`    正确偏移: (${wrongOff[i].x.toFixed(1)}, ${wrongOff[i].y.toFixed(1)})`)
    console.log(`    错误偏移: (${correctOff[i].x.toFixed(1)}, ${correctOff[i].y.toFixed(1)})`)
    break
  }
}

// Now check: does this cause "直连" visual artifact?
// Key question: are the two directions visually overlapping?
console.log(`\n两方向轨道分离检查:`)
const offDist0 = Math.hypot(wrongOff[0].x - correctOff[0].x, wrongOff[0].y - correctOff[0].y)
const offDistMid = Math.hypot(wrongOff[Math.floor(screenPts.length/2)].x - correctOff[Math.floor(screenPts.length/2)].x, 
                              wrongOff[Math.floor(screenPts.length/2)].y - correctOff[Math.floor(screenPts.length/2)].y)
console.log(`  起点处偏移偏差: ${offDist0.toFixed(2)}px`)
console.log(`  中段偏移偏差: ${offDistMid.toFixed(2)}px`)

// Check: how much do wrong/correct offsets differ in practice?
// For a truly horizontal segment (left→right):
//   Wrong: dx_screen = dy_latlng = small, dy_screen = dx_latlng = large
//   → perpendicular computed incorrectly → ~90° rotation of offset
console.log(`\n关键结论:`)
console.log(`- offsetPolyline 传入的点是 {lat,lng} 格式（经过 toScreen 转换后是 screen coords）`)
console.log(`- 但 offsetPolyline 内部用 .latitude/.longitude 访问 → 实际拿到的是 x/y screen coords`)
console.log(`- 对于近乎水平的路段，横向偏移量会被误算为纵向偏移，导致分轨方向错误`)
console.log(`- 但这主要影响的是"分轨"（两个方向的间距），不是"直连"问题的根因`)
