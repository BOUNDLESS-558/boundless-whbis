/**
 * 历史营运快照回填脚本
 *
 * 把 src/static/vehicle-ops/YYYY-MM-DD/HHMM.json 按 (日期, 自编号) 聚合后，
 * 通过 POST /api/vehicle-ops 写入 vehicle_ops_daily（dailyOnly，不碰累计表）。
 *
 * 用法：
 *   node scripts/backfill-vehicle-ops.mjs --dry     # 只统计，不写库
 *   VEHICLE_OPS_API=https://<域>/api/vehicle-ops VEHICLE_OPS_TOKEN=<token> \
 *     node scripts/backfill-vehicle-ops.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.resolve(ROOT, 'src/static/vehicle-ops')
const API = String(process.env.VEHICLE_OPS_API || '').replace(/\/$/, '')
const TOKEN = String(process.env.VEHICLE_OPS_TOKEN || '')
const DRY = process.argv.includes('--dry')
const BATCH = 200

if (!DRY && (!API || !TOKEN)) {
  console.error('缺少 VEHICLE_OPS_API / VEHICLE_OPS_TOKEN，或加 --dry 只统计')
  process.exit(1)
}

const max = (a, b) => Math.max(Number(a) || 0, Number(b) || 0)
function mergeSlot(cur, b, recordedAt) {
  if (!cur) {
    return {
      orgId: b.orgId, lineNo: b.lineNo || '', company: b.company || '',
      maxSpeed: Number(b.maxSpeed) || 0, speedCount: Number(b.speedCount) || 0,
      onlineAt: b.onlineAt || '', offlineAt: b.offlineAt || '',
      departures: Number(b.departures) || 0, samples: Number(b.samples) || 0,
      transfers: b.transfers || [], lines: b.lines || [], date: cur?.date, recordedAt,
    }
  }
  cur.maxSpeed = max(cur.maxSpeed, b.maxSpeed)
  cur.speedCount = max(cur.speedCount, b.speedCount)
  cur.departures = max(cur.departures, b.departures)
  cur.samples = max(cur.samples, b.samples)
  if (b.onlineAt && (!cur.onlineAt || b.onlineAt < cur.onlineAt)) cur.onlineAt = b.onlineAt
  if (b.offlineAt && b.offlineAt > cur.offlineAt) cur.offlineAt = b.offlineAt
  if (b.lineNo) cur.lineNo = b.lineNo
  if (b.company) cur.company = b.company
  if (b.lines && b.lines.length) cur.lines = b.lines
  if (b.transfers && b.transfers.length) cur.transfers = b.transfers
  cur.recordedAt = recordedAt
  return cur
}

const days = fs.readdirSync(OUT_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort()
if (!days.length) {
  console.error(`未找到按日快照：${OUT_DIR}`)
  process.exit(1)
}

const slots = new Map() // key = date|orgId
for (const day of days) {
  const dir = path.resolve(OUT_DIR, day)
  const files = fs.readdirSync(dir).filter((n) => /^\d{4}\.json$/.test(n)).sort()
  for (const file of files) {
    const j = JSON.parse(fs.readFileSync(path.resolve(dir, file), 'utf8'))
    const at = String(j.at || `${day} ${file.slice(0, 2)}:${file.slice(2)}`)
    const recordedAt = (at.match(/\d{2}:\d{2}/) || [''])[0]
    for (const b of Object.values(j.buses || {})) {
      const orgId = String(b.orgId || '')
      if (!orgId) continue
      const key = `${day}|${orgId}`
      const cur = slots.get(key)
      const merged = mergeSlot(cur, b, recordedAt)
      merged.date = day
      slots.set(key, merged)
    }
  }
}

const byDate = new Map()
for (const row of slots.values()) {
  if (!byDate.has(row.date)) byDate.set(row.date, [])
  byDate.get(row.date).push(row)
}
let total = 0
for (const [date, rows] of [...byDate.entries()].sort()) {
  console.log(`${date}: ${rows.length} 辆`)
  total += rows.length
}
console.log(`合计 ${total} 条（${byDate.size} 天）`)
if (DRY) {
  console.log('--dry：未写库')
  process.exit(0)
}

let ok = 0
for (const [date, rows] of byDate.entries()) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const buses = rows.slice(i, i + BATCH)
    const last = buses[buses.length - 1]
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TOKEN },
      body: JSON.stringify({
        at: `${date} ${last.recordedAt || '00:00'}`,
        dailyOnly: true,
        buses: buses.map(({ date: _d, ...b }) => b),
      }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error(`× 回填失败 ${date} 第 ${i / BATCH + 1} 批：HTTP ${res.status} ${JSON.stringify(j)}`)
      process.exit(1)
    }
    ok += j.upserted || buses.length
  }
}
console.log(`√ 已回填 ${ok} 条到 vehicle_ops_daily`)
