/**
 * 站点序列清洗回归测试（纯离线、不发请求、不写文件）
 *
 * 用线路静态资产的真实 stops（jt/cc/ml/hq 分片）当样本，
 * 验证 cleanStops 能消掉上游错误坐标造成的折返，且不误伤正常线路。
 * 用法：npm run test:routeclean
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import RC from './_loadRouteClean.mjs'

const { cleanStops, pointsOf, routeStats, shardOf } = RC
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LINES_DIR = path.join(ROOT, 'src/static/lines')
const GROUPS = [
  { dir: 'jt', re: /^b\d+\.json$/ },
  { dir: 'cc', re: /^CCB\d+\.json$/ },
  { dir: 'ml', re: /^MLB\d+\.json$/ },
  { dir: 'hq', re: /^HQB\d+\.json$/ },
]
const NET = { lines: [] }
for (const g of GROUPS) {
  const d = path.join(LINES_DIR, g.dir)
  if (!fs.existsSync(d)) continue
  for (const name of fs.readdirSync(d)) {
    if (!g.re.test(name)) continue
    const j = JSON.parse(fs.readFileSync(path.join(d, name), 'utf8'))
    for (const [no, row] of Object.entries(j.lines || {})) {
      const dirs = []
      for (const [dk, dr] of Object.entries(row.dirs || {})) {
        if ((dr.stops || []).length >= 2) dirs.push({ d: Number(dk), stops: dr.stops })
      }
      if (dirs.length) NET.lines.push({ no, dirs })
    }
  }
}

const before = { points: 0, jumps: 0, huge: 0, foldbacks: 0, dupPairs: 0, backs: 0, outliers: 0, dups: 0, maxJump: 0 }
const after = { points: 0, jumps: 0, huge: 0, foldbacks: 0, dupPairs: 0, backs: 0, outliers: 0, dups: 0, maxJump: 0 }
let dirs = 0
let changed = 0
let reordered = 0
let clusterPts = 0
let worst = null

for (const l of NET.lines || []) {
  for (const d of l.dirs || []) {
    const raw = (d.stops || []).map((s, i) => ({
      stopId: s.stopId || `t${l.no}-${d.d}-${i}`,
      stopName: s.stopName || `站${i + 1}`,
      stopNo: Number.isFinite(Number(s.stopNo)) ? Number(s.stopNo) : i + 1,
      latitude: s.latitude,
      longitude: s.longitude,
    }))
    if (raw.length < 2) continue
    dirs++
    const b = routeStats(pointsOf(raw))
    const { stops, report } = cleanStops(raw)
    const a = routeStats(pointsOf(stops))
    for (const k of ['points', 'jumps', 'huge', 'foldbacks', 'dupPairs', 'backs', 'outliers', 'dups']) {
      before[k] += (b[k] || 0)
      after[k] += (a[k] || 0)
    }
    before.maxJump = Math.max(before.maxJump, b.maxJump)
    after.maxJump = Math.max(after.maxJump, a.maxJump)
    if (stops.length !== raw.length) changed++
    if (report.reordered) reordered++
    clusterPts += report.clusters
    if (b.maxJump > 10000 && (!worst || b.maxJump > worst.before)) {
      worst = { no: l.no, dir: d.d, before: b.maxJump, after: a.maxJump, removed: raw.length - stops.length }
    }
  }
}

const pct = (n, d) => d ? `${((1 - n / d) * 100).toFixed(1)}%` : '0%'
console.log(`样本：${dirs} 个方向 / ${before.points} 个站点坐标`)
console.log(`清洗后变化的方向 ${changed} 个，按 stopNo 重排 ${reordered} 个，共剔除 ${before.points - after.points} 个站点（其中折返簇 ${clusterPts} 个）`)
console.log('指标'.padEnd(14), '清洗前'.padEnd(10), '清洗后'.padEnd(10), '降幅')
for (const [k, label] of [['foldbacks', '折返段(折叠)'], ['dupPairs', '整段重复坐标对'], ['huge', '瞬跳>10km'], ['jumps', '跳变>1.5km'], ['backs', '大回头>120°'], ['outliers', '孤立离群点'], ['dups', '重合<5m']]) {
  console.log(label.padEnd(14), String(before[k]).padEnd(10), String(after[k]).padEnd(10), pct(after[k], before[k]))
}
console.log('最大单段距离(m)'.padEnd(14), String(before.maxJump).padEnd(10), String(after.maxJump).padEnd(10))
if (worst) console.log(`最极端样本：${worst.no} 路 dir${worst.dir} 单段 ${worst.before}m → ${worst.after}m（剔除 ${worst.removed} 个错误点）`)

// 分片函数：确定性 + 分布均匀
const sh = new Set()
for (const l of NET.lines || []) sh.add(shardOf(l.no))
if (shardOf('337') !== shardOf('337')) throw new Error('shardOf 不确定')
if (sh.size < 20) throw new Error('分片分布过集中')

// 断言：只要求「错误点清零、单向长跳与真实掉头不增加、站点不被大规模误删」。
// 大回头 / 跳变里有很多是真实掉头与跨区线路，不能要求大幅下降，否则会诱导过度剔除。
if (after.outliers !== 0) throw new Error(`仍有 ${after.outliers} 个孤立离群点未剔除`)
if (after.dups > before.dups * 0.1) throw new Error('重合站点清除不足 90%')
if (after.backs > before.backs) throw new Error('大回头段反而增加')
if (after.jumps > before.jumps) throw new Error('长跳变段反而增加')
if (after.points < before.points * 0.95) throw new Error('剔除了超过 5% 的站点，可能误伤')
// 只剩 2 个有效站点的 D 线（上游本就残缺）仍会留下 30km+ 单向长跳，那是「一条长直线」而非折叠，
// 清洗不该删到线路消失；因此用「>10km 瞬跳段数」而不是全局 maxJump 做收敛判据。
if (after.foldbacks !== 0) throw new Error(`仍有 ${after.foldbacks} 段「甩出去再折回来」的折叠走向`)
// 真实 stops 里的 >10km 段多为跨区/残缺线路的单向长直线，不是折叠；只要求清洗后不增加
if (after.huge > before.huge) throw new Error('超 10km 单向长跳段增加')
if (worst && worst.after > worst.before) throw new Error('最极端样本未收敛')
console.log('\nPASS：清洗规则有效且未误伤')
