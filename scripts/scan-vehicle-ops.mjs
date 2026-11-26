/**
 * 全车营运信息采集（每 15 分钟由 GitHub Actions 触发）
 *
 * 遍历 lines.json 全部在运线路 × 所有方向，逐车采集 detailData 实时数据，
 * 按「自编号 orgId」聚合出每辆车的营运档案，按日期时间分片落盘到
 *   src/static/vehicle-ops/YYYY-MM-DD/HHMM.json
 * 维护一份跨分片累计档案
 *   src/static/vehicle-ops/profile.json  （数据面板「同步」读取此文件）
 *
 * 单车档案字段（数据面板展示）：
 *   orgId        自编号
 *   maxSpeed     历史最高车速（跨分片取最大）
 *   speedCount   超速次数（车速 > SPEED_LIMIT 的采样次数）
 *   onlineAt     首次上线时间（首次出现的采集时刻）
 *   offlineAt    最后在线时间（最近一次出现的采集时刻）
 *   departures   历史发车次数（跨分片出现次数）
 *   transfers    车辆调配记录（线路变更历史，[{from,to,at}]）
 *   company      所属营运公司（按 orgId 首位数字推断）
 *   lines        出现过的线路号集合
 *
 * 请求协议三条铁律：POST + application/json；openId 放请求头；值任意非空。
 * 环境变量：SCAN_BASE（上游反代）、OPS_CONCURRENCY / OPS_DELAY（限速）。
 * 用法：node scripts/scan-vehicle-ops.mjs [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { md5 } from '../src/utils/md5.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LINES_FILE = path.resolve(ROOT, 'src/static/lines/lines.json')
const OUT_DIR = path.resolve(ROOT, 'src/static/vehicle-ops')
const PROFILE_FILE = path.resolve(OUT_DIR, 'profile.json')
const BASE = process.env.SCAN_BASE || 'https://customized.wuhanbus.com/gps-resapi/wechat/bus'
const CITY = '420100'
const HEADERS = { 'Content-Type': 'application/json', openId: 'wx_openid_dev_001' }
const COMMON = {
  cityCode: CITY,
  xiaomaAppId: 'wxaa1d01cdc96a2c0c',
  appKey: 'A0CADFE6F3B914A2',
  appType: 4,
  codeType: 1,
  channelId: 23000003,
  appSource: 2,
}
const SPEED_LIMIT = Number(process.env.OPS_SPEED_LIMIT || 60) // 超速阈值 km/h
// 最低记录车速：低于此值的车辆视为无效数据（停运/怠速/GPS 漂移），不入库。
// 默认 40 km/h，可用 OPS_MIN_SPEED 覆盖；设 0 关闭过滤。
const MIN_SPEED = Math.max(0, Number(process.env.OPS_MIN_SPEED || 40))
const CONCURRENCY = Math.max(1, Number(process.env.OPS_CONCURRENCY || 6))
const DELAY = Math.max(0, Number(process.env.OPS_DELAY || 25))
const TIMEOUT = 15000
const DRY = process.argv.includes('--dry')

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const ONLY = String(argOf('only', '')).split(',').map((s) => s.trim()).filter(Boolean)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const GROUP_PREFIX = '武汉市公共交通集团有限责任公司'

// 采集时刻（北京时间）：分片文件名 HHMM 用 UTC+8
const now = new Date()
const bj = new Date(now.getTime() + 8 * 3600 * 1000)
const p = (n) => String(n).padStart(2, '0')
const DATE = `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())}`
const HHMM = `${p(bj.getUTCHours())}${p(bj.getUTCMinutes())}`
const AT = `${DATE} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`

// 当前分片：orgId -> 车实时记录
const slice = {}
// 全局看板快照（本轮所有线路的车辆，按线路号分组，供数据面板展示）
const busesByLine = {}

// MD5(自编号) -> 明文（首位数字 = 营运公司）
// 20 万条 MD5 每轮重建很慢，Actions 用 actions/cache 持久化本文件；本地首次运行自动构建。
const DICT_CACHE = process.env.MD5_DICT_CACHE || path.resolve(ROOT, '.cache/vehicle-ops-md5-dict.json')
const dict = new Map()
let dictFromCache = false
try {
  const cached = JSON.parse(fs.readFileSync(DICT_CACHE, 'utf8'))
  for (const [k, v] of Object.entries(cached)) dict.set(k, v)
  dictFromCache = dict.size > 0
} catch (e) { /* 首次运行或缓存失效：现场构建 */ }
if (!dictFromCache) {
  for (let i = 0; i <= 200000; i++) {
    const s = String(i)
    const h = md5(s)
    if (!dict.has(h)) dict.set(h, s)
  }
  try {
    fs.mkdirSync(path.dirname(DICT_CACHE), { recursive: true })
    fs.writeFileSync(DICT_CACHE, JSON.stringify(Object.fromEntries(dict)))
  } catch (e) { console.log(`MD5 字典缓存写入失败（不影响采集）：${e.message}`) }
}
console.log(`MD5 反查字典：${dict.size} 条（${dictFromCache ? '缓存命中' : '现场构建'}）`)

const db = JSON.parse(fs.readFileSync(LINES_FILE, 'utf8'))
const lines = (db.lines || []).filter((l) => {
  if (l.status === '停运' || !l.stops) return false
  if (ONLY.length && !ONLY.includes(String(l.no))) return false
  return true
})
console.log(`待采线路：${lines.length} 条`)

async function detailData(lineId) {
  const res = await fetch(BASE + '/detailData', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ ...COMMON, lineId }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  return await res.json()
}

function plainOf(b) {
  return dict.get(String(b.busId || b.busNo || '').toLowerCase()) || ''
}

function companyOf(plain) {
  const d = plain.charAt(0)
  return d >= '1' && d <= '9' ? `${GROUP_PREFIX}${CN[Number(d)]}营运公司` : '其他/非集团'
}

function numSpeed(b) {
  const n = Number(b.gpsSpeed)
  return Number.isFinite(n) ? n : 0
}

// 并发遍历线路 × 方向
const jobs = []
for (const l of lines) {
  const code = l.code || l.no
  for (const dir of (l.dirs && l.dirs.length ? l.dirs : [0])) {
    jobs.push({ no: String(l.no), code, dir })
  }
}
console.log(`采集任务：${jobs.length} 个（线路×方向）`)

let next = 0
let ok = 0, fail = 0, busCount = 0
const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
  while (true) {
    const i = next++
    if (i >= jobs.length) return
    const j = jobs[i]
    const lineId = `${CITY}-${j.code}-${j.dir}`
    let payload
    try {
      payload = await detailData(lineId)
    } catch (e) {
      fail++
      continue
    }
    if (!payload || payload.success !== true || !payload.msg || payload.msg.code !== '20000') { fail++; continue }
    const list = (payload.data && payload.data.lineBusDtoList) || []
    ok++
    if (!busesByLine[j.no]) busesByLine[j.no] = []
    for (const b of list) {
      const plain = plainOf(b)
      const orgId = plain || String(b.busNo || b.busId || '')
      if (!orgId) continue
      const speed = numSpeed(b)
      // 低速过滤：低于 MIN_SPEED 的车辆不记录（停运/怠速/GPS 漂移等无效数据）
      if (speed < MIN_SPEED) continue
      busCount++
      const gpsTime = String(b.gpsTime || '')
      const time = gpsTime.length >= 14
        ? `${gpsTime.slice(4, 6)}-${gpsTime.slice(6, 8)} ${gpsTime.slice(8, 10)}:${gpsTime.slice(10, 12)}:${gpsTime.slice(12, 14)}`
        : AT
      const rec = slice[orgId] || (slice[orgId] = {
        orgId,
        lineNo: j.no,          // 营运线路号（本轮采到的线路，如 337）；跨分片取最后一次
        maxSpeed: 0,
        speedCount: 0,
        onlineAt: AT,
        offlineAt: AT,
        departures: 0,
        transfers: [],
        company: companyOf(plain),
        lines: [],
        samples: 0,
      })
      if (speed > rec.maxSpeed) rec.maxSpeed = speed
      if (speed > SPEED_LIMIT) rec.speedCount++
      if (AT < rec.onlineAt) rec.onlineAt = AT
      if (AT > rec.offlineAt) rec.offlineAt = AT
      rec.departures++
      rec.samples++
      rec.lineNo = j.no
      if (!rec.lines.includes(j.no)) {
        if (rec.lines.length) rec.transfers.push({ from: rec.lines[rec.lines.length - 1], to: j.no, at: AT })
        rec.lines.push(j.no)
      }
      busesByLine[j.no].push({ orgId, no: j.no, dir: j.dir, speed, time, arrived: b.arrived, busOrder: b.busOrder })
    }
    await sleep(DELAY)
  }
})
await Promise.all(workers)

console.log(`采集完成：成功 ${ok} / 失败 ${fail} / 车辆样本 ${busCount}`)

if (DRY) {
  console.log('--dry：未写文件')
  process.exit(0)
}

// 落盘分片
fs.mkdirSync(path.resolve(OUT_DIR, `./${DATE}`), { recursive: true })
const sliceFile = path.resolve(OUT_DIR, DATE, `${HHMM}.json`)
const sliceOut = {
  at: AT,
  date: DATE,
  speedLimit: SPEED_LIMIT,
  lineCount: ok,
  busCount,
  lines: busesByLine,
  buses: slice,
}
fs.writeFileSync(sliceFile, JSON.stringify(sliceOut, null, 2) + '\n', 'utf8')
console.log(`√ 已写分片 ${path.relative(ROOT, sliceFile)}`)

// 累计档案：读旧 profile，按 orgId 合并
let profile = { updated: AT, speedLimit: SPEED_LIMIT, days: [], buses: {} }
try {
  const old = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'))
  if (old && old.buses && typeof old.buses === 'object') profile = old
} catch (e) { /* 首次运行 */ }

for (const [orgId, rec] of Object.entries(slice)) {
  const prev = profile.buses[orgId] || (profile.buses[orgId] = {
    orgId, lineNo: rec.lineNo, maxSpeed: 0, speedCount: 0, onlineAt: rec.onlineAt, offlineAt: rec.offlineAt,
    departures: 0, transfers: [], company: rec.company, lines: [], samples: 0,
  })
  prev.lineNo = rec.lineNo || prev.lineNo
  if (rec.maxSpeed > prev.maxSpeed) prev.maxSpeed = rec.maxSpeed
  prev.speedCount += rec.speedCount
  if (rec.onlineAt < prev.onlineAt) prev.onlineAt = rec.onlineAt
  if (rec.offlineAt > prev.offlineAt) prev.offlineAt = rec.offlineAt
  prev.departures += rec.departures
  prev.samples += rec.samples
  prev.company = rec.company || prev.company
  for (const ln of rec.lines) {
    if (!prev.lines.includes(ln)) {
      if (prev.lines.length) prev.transfers.push({ from: prev.lines[prev.lines.length - 1], to: ln, at: rec.offlineAt })
      prev.lines.push(ln)
    }
  }
  // 合并调配记录（按 from+to+at 去重）
  const seen = new Set(prev.transfers.map((t) => `${t.from}|${t.to}|${t.at}`))
  for (const t of rec.transfers) {
    const k = `${t.from}|${t.to}|${t.at}`
    if (!seen.has(k)) { prev.transfers.push(t); seen.add(k) }
  }
}

if (!profile.days.includes(DATE)) profile.days.push(DATE)
profile.days.sort()
profile.updated = AT
profile.speedLimit = SPEED_LIMIT
fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2) + '\n', 'utf8')
console.log(`√ 已写累计档案 ${path.relative(ROOT, PROFILE_FILE)}（${Object.keys(profile.buses).length} 辆车）`)

// ── 同步到 Vercel 数据库（通过 Serverless Function）──
// 环境变量 VEHICLE_OPS_API = https://<你的vercel域>/api/vehicle-ops
//           VEHICLE_OPS_TOKEN = 与 Vercel 环境变量同名同值（POST 鉴权）
// 缺任一则跳过（静态 JSON 仍落盘，向后兼容）。
const OPS_API = process.env.VEHICLE_OPS_API || ''
const OPS_TOKEN = process.env.VEHICLE_OPS_TOKEN || ''
if (OPS_API && OPS_TOKEN) {
  try {
    const res = await fetch(OPS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': OPS_TOKEN },
      body: JSON.stringify({ at: AT, buses: Object.values(slice) }),
      signal: AbortSignal.timeout(30000),
    })
    const j = await res.json()
    if (res.ok) console.log(`√ 已同步到 Vercel 数据库：${j.upserted} 辆车`)
    else console.log(`× Vercel API 返回 ${res.status}：${JSON.stringify(j)}`)
  } catch (e) {
    console.log(`× 同步 Vercel 数据库失败（不影响本地落盘）：${e.message}`)
  }
} else {
  console.log('（未配 VEHICLE_OPS_API / VEHICLE_OPS_TOKEN，跳过数据库同步）')
}
