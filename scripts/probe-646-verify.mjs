/**
 * 诊断：检查 646路 的"直连"视觉问题（验证版）
 */
import { readFileSync } from 'fs'

// Force re-read every time
const filePath = 'src/static/lines/jt/b35.json'
console.error('Reading from:', filePath)
const b35 = JSON.parse(readFileSync(filePath, 'utf-8'))
const dir0 = b35.lines['646'].dirs['0']
const dir1 = b35.lines['646'].dirs['1']

console.log(`dir0 route length: ${dir0.route.length}`)
console.log(`dir1 route length: ${dir1.route.length}`)

// Parse flat [lng,lat] array
function parseRoute(routeArr) {
  const pts = []
  for (let i = 0; i < routeArr.length; i += 2) {
    pts.push({ lng: routeArr[i], lat: routeArr[i+1] })
  }
  return pts
}

const pts0 = parseRoute(dir0.route)
const pts1 = parseRoute(dir1.route)
console.log(`dir0 parsed pts: ${pts0.length}`)
console.log(`dir1 parsed pts: ${pts1.length}`)

// Compute spacing stats
function stats(pts) {
  let totalLen = 0, maxJump = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i].lng - pts[i-1].lng) * 111320 * Math.cos((pts[i].lat + pts[i-1].lat)/2 * Math.PI/180)
    const dy = (pts[i].lat - pts[i-1].lat) * 110540
    const len = Math.sqrt(dx*dx + dy*dy)
    totalLen += len
    if (len > maxJump) maxJump = len
  }
  return { avg: totalLen/(pts.length-1), max: maxJump, nPts: pts.length }
}

const s0 = stats(pts0), s1 = stats(pts1)
console.log(`\n方向0: ${s0.nPts}点, 平均段${s0.avg.toFixed(0)}m, 最大跳${s0.max.toFixed(0)}m`)
console.log(`方向1: ${s1.nPts}点, 平均段${s1.avg.toFixed(0)}m, 最大跳${s1.max.toFixed(0)}m`)

// Screen estimate
const lats = pts0.map(p=>p.lat), lngs = pts0.map(p=>p.lng)
const latSpan = Math.max(...lats) - Math.min(...lats)
const lngSpan = Math.max(...lngs) - Math.min(...lngs)
const kmY = latSpan * 110.54
const kmX = lngSpan * 111.32 * Math.cos(((Math.min(...lats)+Math.max(...lats))/2) * Math.PI/180)
const scaleX = (375-120) / Math.max(kmX, 0.1)
const scaleY = (640-240) / Math.max(kmY, 0.1)
const scale = Math.min(scaleX, scaleY)
console.log(`\nscale: ${scale.toFixed(1)} px/km (view: ${(kmX/1000).toFixed(2)}×${(kmY/1000).toFixed(2)}km)`)
console.log(`dir0: 平均${(s0.avg/1000*scale).toFixed(1)}px, 最大${(s0.max/1000*scale).toFixed(1)}px`)
console.log(`dir1: 平均${(s1.avg/1000*scale).toFixed(1)}px, 最大${(s1.max/1000*scale).toFixed(1)}px`)
