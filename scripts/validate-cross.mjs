#!/usr/bin/env node
/**
 * 交叉验证：官方线路库（customized.wuhanbus.com /line）vs 高德覆盖，输出数据质量报告。
 *
 * 对应需求 3「用高德 API 与官方 API 做数据交叉验证，确保线路真实、无缺失、站点正确」：
 *   - 每条集团线路：资产里走向来源（amap / osrm / 缺失），与高德台账（done / not-found / no-match）对照
 *   - 标记异常：官方有线路却无走向（数据缺失）、高德未收录→OSRM 兜底、方向未匹配
 *   - 非集团线路（蔡城/木兰/汉奇）按公司统计覆盖
 * 产物：reports/cross-validation.json（随数据一起提交，可追溯）
 */
import fs from 'node:fs'
import path from 'node:path'

const RC = (await import('./_loadRouteClean.mjs')).default
const { shardOf } = RC

const DIR = path.resolve('src/static/lines')
const lib = JSON.parse(fs.readFileSync(path.resolve('src/static/lines.json'), 'utf8'))
const foreignLib = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve('src/static/foreign-lines.json'), 'utf8'))
  } catch {
    return { lines: [] }
  }
})()
let progress = {}
try {
  progress = (JSON.parse(fs.readFileSync(path.resolve('scripts/.amap-progress.json'), 'utf8')) || {}).lines || {}
} catch {
  /* 无台账 */
}

function assetOf(no) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, shardOf(no) + '.json'), 'utf8'))
    return j.lines[String(no)]
  } catch {
    return null
  }
}
function sourceOf(no) {
  const a = assetOf(no)
  if (!a) return 'missing'
  const srcs = new Set()
  for (const d of ['0', '1']) {
    const r = a.dirs && a.dirs[d]
    if (r && r.source) srcs.add(r.source)
  }
  if (srcs.has('amap')) return 'amap'
  if (srcs.has('osrm')) return 'osrm'
  if (srcs.size) return [...srcs].join('+')
  return 'none'
}

const report = {
  generatedAt: new Date().toISOString(),
  group: { total: 0, bySource: {}, missingRoute: [], missingStopData: [] },
  foreign: { total: 0, byCompany: {}, missingRoute: [] },
  ledger: {},
  anomalies: [],
}

let gTotal = 0
const gAmap = 0
for (const l of lib.lines || []) {
  if (l.status === '停运') continue
  gTotal++
  const src = sourceOf(l.no)
  report.group.bySource[src] = (report.group.bySource[src] || 0) + 1
  if (src === 'missing' || src === 'none') report.group.missingRoute.push(l.no)

  // 站点数据正确性粗检：资产应有 ≥2 个站点且坐标合法
  const a = assetOf(l.no)
  if (a) {
    for (const d of ['0', '1']) {
      const r = a.dirs && a.dirs[d]
      if (!r) continue
      const stops = (r.stops || []).filter((s) => s.longitude > 73 && s.longitude < 135 && s.latitude > 24 && s.latitude < 54)
      if (stops.length < 2) report.group.missingStopData.push(`${l.no}#${d}`)
    }
  }

  const led = progress[String(l.no)]
  if (led) report.ledger[l.no] = led
  // 异常：台账称高德未收录(not-found)，资产却标 amap 走向 → 数据不自洽
  if (led === 'not-found' && src === 'amap') {
    report.anomalies.push({ no: l.no, type: 'ledger-mismatch', detail: '台账 not-found 但资产含 amap 走向' })
  }
}
report.group.total = gTotal

const byComp = {}
for (const l of foreignLib.lines || []) {
  const c = l.companyKey || 'JT'
  byComp[c] = (byComp[c] || 0) + 1
  const a = assetOf(l.no)
  const ok = a && ['0', '1'].some((d) => a.dirs && a.dirs[d] && (a.dirs[d].route || []).length >= 4)
  if (!ok) report.foreign.missingRoute.push(l.no)
}
report.foreign.byCompany = byComp
report.foreign.total = (foreignLib.lines || []).length

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/cross-validation.json', JSON.stringify(report, null, 2) + '\n', 'utf8')

console.log(`交叉验证完成：集团 ${gTotal} 条，来源分布 ${JSON.stringify(report.group.bySource)}`)
console.log(`非集团 ${report.foreign.total} 条，按公司 ${JSON.stringify(report.foreign.byCompany)}`)
if (report.group.missingRoute.length) console.log(`缺走向线路(${report.group.missingRoute.length})前20：${report.group.missingRoute.slice(0, 20).join(', ')}`)
if (report.group.missingStopData.length) console.log(`站点数据异常(${report.group.missingStopData.length})前20：${report.group.missingStopData.slice(0, 20).join(', ')}`)
if (report.anomalies.length) console.log('异常：' + JSON.stringify(report.anomalies))
console.log('报告已写 reports/cross-validation.json')
