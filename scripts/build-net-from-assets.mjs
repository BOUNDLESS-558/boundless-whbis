/**
 * 由线路静态资产（站点 + 走向）生成全市线网底图 src/static/net/network.json
 *
 * 旧 network.json 来自 /line 站点坐标串的站间直连，缺贴路几何、无站名。
 * 本生成器改用各线路分片里的 stops + route（高德官方轨迹 / OSRM 吸附），
 * 并经 src/utils/routeClean.js（唯一清洗真源）清洗站点与抽稀几何，
 * 产出与 cityBus.normalizeNet() 兼容的同构数据：lines[].dirs[].p 为展平经纬度。
 *
 * 用法：node scripts/build-net-from-assets.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import rc from './_loadRouteClean.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LINES_DIR = path.resolve(ROOT, 'src/static/lines')
const OUT = path.resolve(ROOT, 'src/static/net/network.json')

const GROUPS = [
  { dir: 'jt', re: /^b\d+\.json$/ },
  { dir: 'cc', re: /^CCB\d+\.json$/ },
  { dir: 'ml', re: /^MLB\d+\.json$/ },
  { dir: 'hq', re: /^HQB\d+\.json$/ },
]
const files = []
for (const g of GROUPS) {
  const d = path.join(LINES_DIR, g.dir)
  if (!fs.existsSync(d)) continue
  for (const name of fs.readdirSync(d)) {
    if (g.re.test(name)) files.push(path.join(d, name))
  }
}

const lines = []
let dirCount = 0
let pointCount = 0
const seen = new Set()
const bbox = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity }

function validFlat(arr) {
  const out = []
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const lng = Number(arr[i]), lat = Number(arr[i + 1])
    if (!isFinite(lng) || !isFinite(lat)) continue
    if (lng < 73 || lng > 135 || lat < 24 || lat > 54) continue
    out.push([lng, lat])
  }
  return out
}

for (const file of files) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [no, row] of Object.entries(j.lines || {})) {
    if (seen.has(no)) continue
    const entry = { no: String(no), code: String(no), dirs: [] }
    for (const d of ['0', '1']) {
      const dir = row.dirs && row.dirs[d]
      if (!dir) continue
      // 站点清洗是唯一真源；route 优先（贴路几何），缺失时退化为清洗后的站点连线
      const stops = rc.cleanStops(dir.stops || []).stops
      const stopPts = rc.pointsOf(stops)
      let pts = validFlat(dir.route || []).map(([lng, lat]) => ({ lng, lat }))
      if (!pts.length) pts = stopPts
      if (pts.length < 2) continue
      // 线网底图只需城市级骨架，~20m 容差抽稀，避免 10 万+ 点拖慢首屏
      pts = rc.simplify(pts, 0.0004)
      const p = rc.toFlat(pts)
      if (p.length < 4) continue
      entry.dirs.push({ d: Number(d), p })
      dirCount++
      pointCount += p.length / 2
      for (let i = 0; i + 1 < p.length; i += 2) {
        bbox.minLng = Math.min(bbox.minLng, p[i]); bbox.maxLng = Math.max(bbox.maxLng, p[i])
        bbox.minLat = Math.min(bbox.minLat, p[i + 1]); bbox.maxLat = Math.max(bbox.maxLat, p[i + 1])
      }
    }
    if (entry.dirs.length) { lines.push(entry); seen.add(no) }
  }
}

lines.sort((a, b) => String(a.no).localeCompare(String(b.no), 'zh', { numeric: true }))

const out = {
  city: '420100',
  cityName: '武汉',
  updated: new Date().toISOString(),
  source: '线路静态资产 stops + route（高德官方轨迹 / OSRM 贴路吸附），经 routeClean.js 清洗生成',
  bbox,
  count: lines.length,
  dirCount,
  stopCount: pointCount,
  lines,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out) + '\n', 'utf8')
console.log(`已生成 ${OUT}`)
console.log(JSON.stringify({ count: lines.length, dirCount, pointCount }, null, 2))
