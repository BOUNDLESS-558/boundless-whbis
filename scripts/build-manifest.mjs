/**
 * 生成线路资产清单 src/static/lines/manifest.json（开发期索引，不进 bundle）。
 * 目的：64 个分片是运行时按需加载用的（刻意不分进 lines.json，否则首屏 bundle 膨胀），
 * 但人读/管理时不方便。这个清单把每条线的 source/snapped/几何质量汇总到一个文件，
 * 让你一眼看清全量覆盖情况，无需翻 64 个分片。
 *
 *   用法：node scripts/build-manifest.mjs
 * 每次跑完 scan-routes / scan-routes-amap 后重跑本脚本即可刷新。
 */
import fs from 'node:fs'
import path from 'node:path'
const RC = (await import('./_loadRouteClean.mjs')).default
const H = RC.haversine

const LINES_DIR = 'src/static/lines'
const LIB = 'src/static/lines.json'
const OUT = path.join(LINES_DIR, 'manifest.json')

const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const nameOf = new Map((lib.lines || []).map((l) => [String(l.no), l.name]))

const files = fs.readdirSync(LINES_DIR).filter((x) => /^b\d+\.json$/.test(x))
const summary = { total: 0, amap: 0, osrm: 0, empty: 0, shards: files.length, totalPoints: 0 }
const lines = {}

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(LINES_DIR, f), 'utf8'))
  for (const [no, row] of Object.entries(j.lines || {})) {
    const dirs = {}
    let srcSet = new Set()
    for (const d of ['0', '1']) {
      const r = row.dirs && row.dirs[d]
      if (!r) continue
      summary.total++
      const P = RC.fromFlat(r.route || []).map((p) => ({ lat: p.latitude, lng: p.longitude }))
      let chord = 0
      for (let i = 0; i + 1 < P.length; i++) if (H(P[i], P[i + 1]) > 800) chord++
      const source = r.source || (r.empty ? 'empty' : 'osrm')
      srcSet.add(source)
      summary.totalPoints += P.length
      if (source === 'amap') summary.amap++
      else if (source === 'osrm') summary.osrm++
      else summary.empty++
      dirs[d] = { source, snapped: !!r.snapped, points: P.length, chord }
    }
    const srcs = [...srcSet]
    const lineSource = srcs.length === 1 ? srcs[0] : 'mixed'
    lines[no] = { name: nameOf.get(no) || null, source: lineSource, dirs }
  }
}

const manifest = { generatedAt: new Date().toISOString(), summary, lines }
fs.writeFileSync(OUT, JSON.stringify(manifest))
console.log('清单已生成：', OUT)
console.log(JSON.stringify(summary, null, 2))
console.log('示例 211：', JSON.stringify(lines['211']))
console.log('示例 232：', JSON.stringify(lines['232']))
