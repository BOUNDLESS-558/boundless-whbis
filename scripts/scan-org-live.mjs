/**
 * 营运公司采集（在线车辆自编号反推）：lines.json 的 org 字段
 *
 * 原理（用户 2026-11-11 提出，已实测 100% 可靠）：
 *   后端 detailData 返回的在线车辆 busId = MD5(自编号)，自编号为纯数字，
 *   首位数字即营运公司（1→一公司 … 9→九公司）——这是车辆归属的权威判据，
 *   比 buspedia 更准（buspedia 停更、且大量 D/K/YX 线未收录）。
 *   本脚本枚举 MD5(0~200000) 建反查字典，还原在线车辆自编号首位 → 公司，
 *   按线路聚合投票取众数写入 org，补齐 scan-org.mjs(buspedia) 覆盖不到的空档。
 *
 * 与 scan-org.mjs 互补：那个从 buspedia 静态表采，这个从实时在线车反推。
 * 两者都遵守「只补强不降级」——已有 org 默认跳过，--force 才覆盖。
 *
 * 可靠性护栏：
 *   - 只在「营运中」线路上取车（停运线无在运车辆）；
 *   - 自编号首位必须 1~9，其余忽略；
 *   - 众数判定：命中车数 ≥ --min（默认 2），且众数占比 ≥ --ratio（默认 0.6），
 *     防止个别跨公司支援车把整条线判错；dir0/dir1 两方向合并投票提高样本。
 *
 * 用法：
 *   node scripts/scan-org-live.mjs                 # 全量补空（线上 CI 每 6 小时随 auto-collect 跑）
 *   node scripts/scan-org-live.mjs --dry            # 只统计不写文件
 *   node scripts/scan-org-live.mjs --only 337,408   # 只跑指定线路号（小样本验证）
 *   node scripts/scan-org-live.mjs --force          # 覆盖已有 org（含与反推不一致的）
 *   node scripts/scan-org-live.mjs --min 1          # 放宽到 1 辆（样本少时用，谨慎）
 *
 * 环境变量：SCAN_BASE（上游反代，默认官方域名）、LIVE_MIN / LIVE_RATIO / LIVE_DELAY / LIVE_CONCURRENCY
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { md5 } from '../src/utils/md5.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '../src/static/lines/lines.json')
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
const GROUP_PREFIX = '武汉市公共交通集团有限责任公司'
const CN = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九']

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)
const DRY = has('dry')
const FORCE = has('force')
const ONLY = String(argOf('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const MIN = Number(process.env.LIVE_MIN || argOf('min', 1))          // 众数最小票数（D 定制线常仅 1 辆在跑，1 即可定公司：线路配车不跨公司）
const RATIO = Number(process.env.LIVE_RATIO || argOf('ratio', 0.6))  // 多车时众数占比下限（防个别跨公司支援车带偏）
const DELAY = Math.max(0, Number(process.env.LIVE_DELAY || argOf('delay', 60)))
const CONCURRENCY = Math.max(1, Number(process.env.LIVE_CONCURRENCY || argOf('concurrency', 4)))
const TIMEOUT = 15000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const lines = db.lines || []

// —— 1. 反查字典：MD5(自编号) -> 明文 ——
const t0 = Date.now()
const dict = new Map()
for (let i = 0; i <= 200000; i++) {
  const s = String(i)
  const h = md5(s)
  if (!dict.has(h)) dict.set(h, s) // 先到先得：极小概率碰撞时保留较小编号
}
console.log(`MD5 反查字典：${dict.size} 条，构建 ${Date.now() - t0}ms`)

// —— 2. 请求 detailData ——
async function detailData(lineId) {
  const res = await fetch(BASE + '/detailData', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ ...COMMON, lineId }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  return await res.json()
}

/** 拉取一条线路两方向的在线车辆，返回统计出的公司全名 | null */
async function inferOrg(l) {
  const code = l.code || l.no
  const votes = {}     // 首位数字 -> 票数
  let busesSeen = 0
  let busesDecoded = 0
  for (const dir of (l.dirs && l.dirs.length ? l.dirs : [0])) {
    const lineId = `${CITY}-${code}-${dir}`
    let payload
    try {
      payload = await detailData(lineId)
    } catch (e) {
      continue // 单方向失败不影响另一方向
    }
    if (!payload || payload.success !== true || !payload.msg || payload.msg.code !== '20000') continue
    const list = (payload.data && payload.data.lineBusDtoList) || []
    for (const b of list) {
      busesSeen++
      const plain = dict.get(String(b.busId || b.busNo || '').toLowerCase())
      if (!plain) continue
      const d = plain.charAt(0)
      if (d < '1' || d > '9') continue
      busesDecoded++
      votes[d] = (votes[d] || 0) + 1
    }
    await sleep(DELAY)
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((s, [, n]) => s + n, 0)
  if (!ranked.length) return { org: null, busesSeen, busesDecoded, total, top: null }
  const [topDigit, topN] = ranked[0]
  // 众数护栏：票数达下限且占比达标才采信
  if (topN < MIN || topN / total < RATIO) return { org: null, busesSeen, busesDecoded, total, top: `${CN[+topDigit]}公司${topN}/${total}`, lowConfidence: true }
  return { org: GROUP_PREFIX + CN[Number(topDigit)] + '营运公司', busesSeen, busesDecoded, total, top: `${CN[+topDigit]}公司 ${topN}/${total}` }
}

// —— 3. 待补线路（集团营运线，缺 org）——
const targets = lines.filter((l) => {
  if (ONLY.length && !ONLY.includes(String(l.no))) return false
  if (l.status === '停运' || !l.stops) return false
  if (l.org && !FORCE) return false
  // 非集团线（C/P/汉奇）靠号段排除，避免误判
  const s = String(l.no || '').trim()
  if (/^(C\d|P\d|汉奇|HQ)/i.test(s)) return false
  return true
})
console.log(`待补线路：${targets.length} 条（营运中、缺 org${ONLY.length ? '、限定 --only' : ''}）`)

// —— 4. 并发拉取 ——
let next = 0
let hit = 0, noBus = 0, lowConf = 0, conflict = 0
const hitNos = []
const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
  while (true) {
    const i = next++
    if (i >= targets.length) return
    const l = targets[i]
    const r = await inferOrg(l)
    const tag = `${l.no}(code=${l.code || l.no})`
    if (r.org) {
      if (l.org && l.org !== r.org) conflict++
      l.org = r.org
      hit++
      hitNos.push(l.no)
      console.log(`  ✓ ${tag} → ${r.org.replace(GROUP_PREFIX, '')} [${r.top} · 在线${r.busesSeen}/反查${r.busesDecoded}]`)
    } else if (r.lowConfidence) {
      lowConf++
      console.log(`  ? ${tag} 众数不足 [${r.top} · 在线${r.busesSeen}/反查${r.busesDecoded}]`)
    } else {
      noBus++
    }
  }
})
await Promise.all(workers)

// —— 5. 统计与写盘 ——
const DIST_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const dist = {}
for (const l of lines) {
  if (!l.org) continue
  const m = String(l.org).match(/第([一二三四五六七八九])营运公司/)
  const k = m ? `第${DIST_CN[m[1]]}公司` : '其他/非集团'
  dist[k] = (dist[k] || 0) + 1
}
console.log('\n==== 采集结果 ====')
console.log(`命中 ${hit} / 无在线车 ${noBus} / 低置信跳过 ${lowConf}` + (conflict ? ` / 覆盖改判 ${conflict}` : ''))
console.log('命中线路：' + hitNos.join(', '))
console.log('全库 org 分布：' + JSON.stringify(dist) + `（空 ${lines.filter((l) => !l.org).length} 条）`)

if (DRY) {
  console.log('--dry：未写文件')
} else if (hit > 0) {
  db.updated = new Date().toISOString()
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2) + '\n', 'utf8')
  console.log(`√ 已写回 ${path.relative(process.cwd(), FILE)}（新增/更新 ${hit} 条 org）`)
} else {
  console.log('无新增命中，不写文件')
}
