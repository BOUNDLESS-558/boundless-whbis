/**
 * 由非集团线路资产分片生成全市线网补充底图 src/static/network-foreign.json
 *
 * 与 network.json 同构（lines[].dirs[].p 为展平 GCJ-02 坐标），但只含蔡城 / 木兰 / 汉奇线路。
 * 单独成文件而不是直接并进 network.json：集团线网由 scan:net 生成，重跑不会覆盖这部分；
 * 运行时由 cityBus.loadCityNet() 在「其它公交公司」开关开启时按需合并，关闭时零请求。
 *
 * 用法：node scripts/build-foreign-net.mjs   （跑完 scan-foreign.mjs 后执行）
 */
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve('src/static/lines')
const OUT = path.resolve('src/static/network-foreign.json')
const LIB = JSON.parse(fs.readFileSync(path.resolve('src/static/foreign-lines.json'), 'utf8'))

// 公司前缀分片：CCBnn / MLBnn / HQBnn
const files = fs.readdirSync(DIR).filter((f) => /^(CC|ML|HQ)B\d+\.json$/.test(f))
const lines = []
let dirCount = 0
let pointCount = 0
const companies = {}

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  for (const [no, row] of Object.entries(j.lines || {})) {
    const entry = { no, code: no, dirs: [] }
    for (const d of ['0', '1']) {
      const r = row.dirs && row.dirs[d]
      if (!r || !Array.isArray(r.route) || r.route.length < 4) continue
      // 只保留合法经纬度，避免 0/0 把线网拉到海里
      const p = []
      for (let i = 0; i + 1 < r.route.length; i += 2) {
        const ln = Number(r.route[i]), la = Number(r.route[i + 1])
        if (ln > 73 && ln < 135 && la > 24 && la < 54) p.push(ln, la)
      }
      if (p.length < 4) continue
      entry.dirs.push({ d: Number(d), p })
      pointCount += p.length / 2
      dirCount++
      companies[row.dirs[d].company] = (companies[row.dirs[d].company] || 0) + 1
    }
    if (entry.dirs.length) lines.push(entry)
  }
}
lines.sort((a, b) => a.no.localeCompare(b.no, 'zh', { numeric: true }))

const out = {
  city: '420100', cityName: '武汉', updated: new Date().toISOString(),
  source: '高德地图 /v3/bus/linename（经 scan-foreign.mjs 采集，本文件由 build-foreign-net.mjs 生成）',
  note: '非武汉公交集团线路的线网补充；仅在「其它公交公司」开关开启时由 cityBus.js 合并加载',
  count: lines.length, dirCount, stopCount: pointCount,
  libCount: LIB.count, companies, lines,
}
fs.writeFileSync(OUT, JSON.stringify(out) + '\n', 'utf8')
console.log(`已生成 ${OUT}`)
console.log(JSON.stringify({ count: lines.length, dirCount, stopCount: pointCount, companies }, null, 2))
