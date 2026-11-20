/**
 * 全量几何校验：逐方向检查「站点是否贴合走向 polyline」。
 *
 * 用途：
 *   node scripts/validate-routes.mjs                    # 仅报告，不改任何文件
 *   node scripts/validate-routes.mjs --unmark-stale     # 同时清理过期台账
 *   node scripts/validate-routes.mjs --shard b23        # 只查一个分片
 *   node scripts/validate-routes.mjs --max-dev 500      # 放宽阈值（路口微调场景）
 *
 * 这是 646 / 361 事故的防御性审计：线路改道后旧走向与新站点会差 1~3km，
 * 本脚本不发任何网络请求，纯本地扫一遍就能揪出所有「资产陈旧但台账标 done」的线。
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateStopsAgainstPolyline, routeToPoly } from './_validate.mjs'

const argv = process.argv.slice(2)
const has = (n) => argv.includes('--' + n)
const argOf = (n, d) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const OUT = path.resolve(argOf('out', 'src/static/lines'))
const PROGRESS = path.resolve(argOf('progress', 'scripts/.amap-progress.json'))
const ONLY_SHARD = argOf('shard', '')
const MAX_DEV = Number(argOf('max-dev', 200))
const UNMARK_STALE = has('unmark-stale')

// ── 加载所有分片（按公司分子目录 jt/cc/ml/hq，递归收集）──
const shards = {}
for (const sub of fs.readdirSync(OUT)) {
  const dir = path.join(OUT, sub)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (j && j.lines) shards[sub + '/' + f] = j
    } catch (e) { /* 跳过损坏 */ }
  }
}

// ── 加载进度台账 ──
let progress = { lines: {} }
if (fs.existsSync(PROGRESS)) {
  try { const j = JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); if (j.lines) progress.lines = j.lines } catch (e) {}
}

let totalDirs = 0, okDirs = 0, staleLines = new Set()
const issues = []

for (const [shardName, shard] of Object.entries(shards)) {
  for (const [no, line] of Object.entries(shard.lines || {})) {
    if (!line.dirs) continue
    for (const [d, dir] of Object.entries(line.dirs)) {
      totalDirs++
      // 只校验 amap 走向：OSRM 兜底是驾车近似，站点偏离大是正常的，不在本校验范围
      if (dir.source !== 'amap') continue
      if (!dir.stops || dir.stops.length < 2 || !dir.route || dir.route.length < 2) continue
      const poly = routeToPoly(dir.route)
      const r = validateStopsAgainstPolyline(dir.stops, poly, { maxDeviation: MAX_DEV })
      if (r.ok) { okDirs++; continue }
      staleLines.add(no)
      issues.push({
        shard: shardName, no, dir: d,
        source: dir.source,
        maxDev: r.maxDeviation.toFixed(0),
        worst: r.worstStop,
        monotonic: r.monotonic,
        direction: r.direction,
        startStop: dir.base && dir.base.startStop,
        endStop: dir.base && dir.base.endStop,
        wasDone: progress.lines[String(no)] === 'done',
      })
    }
  }
}

// ── 报告 ──
console.log(`\n═══════════════════════════════════════`)
console.log(`线路资产几何校验（阈值 ${MAX_DEV}m）`)
console.log(`═══════════════════════════════════════`)
console.log(`分片 ${Object.keys(shards).length} 个，方向总数 ${totalDirs}，通过 ${okDirs}，异常 ${issues.length}`)
console.log(`涉及线路 ${staleLines.size} 条：${[...staleLines].sort((a, b) => a - b).join(', ')}`)

if (issues.length) {
  console.log(`\n── 异常明细 ──`)
  // 按偏离从大到小排
  issues.sort((a, b) => b.maxDev - a.maxDev)
  for (const r of issues) {
    const flag = r.wasDone ? ' [台账done]' : ''
    console.log(`  ${r.shard} ${r.no} dir${r.dir} 偏离${r.maxDev}m @${r.worst} 站序:${r.monotonic?'OK':'乱'} 方向:${r.direction}${flag}`)
    console.log(`      ${r.startStop} → ${r.endStop}`)
  }
}

// ── 撤销过期台账 ──
if (UNMARK_STALE && staleLines.size) {
  let removed = 0
  for (const no of staleLines) {
    if (progress.lines[String(no)]) {
      delete progress.lines[String(no)]
      removed++
    }
  }
  progress.updated = new Date().toISOString()
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true })
  fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 2) + '\n', 'utf8')
  console.log(`\n已从台账移除 ${removed} 条过期线路，下一轮采集自动重拉。`)
}

if (issues.length && !UNMARK_STALE) {
  console.log(`\n提示：加 --unmark-stale 一键清除这些线路的台账记录，下一轮采集会重新拉高德走向。`)
}
console.log('')