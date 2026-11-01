/**
 * 汉奇线路扫描：枚举汉奇接口 → 持久化进 src/data/lines.json 的 `hanqi` 块
 *
 * 背景：汉奇没有线路列表接口，运行时靠 7 个锚点 /nearby 现扫（LineDb 每次切到
 * 汉奇页签都要重复请求）。这里把扫描结果落盘为静态资产，前端直接读本地数据，
 * ↻ 只作手动重扫。
 *
 * 流程：
 *   1) 各锚点 /nearby 合并去重 → 线路摘要（lineId/routeName/first/last/price/isBidirectional）
 *   2) 逐条 /realtime 富化 起讫站/票价/站数（--no-detail 跳过，只要摘要）
 *   3) 读现有 lines.json，只替换 `hanqi` 块（武汉公交 lines 数组原样保留）；
 *      --merge 时与已落盘的汉奇块合并（只补强不降级，分批扫描累加用）
 *
 * 用法：
 *   node scripts/scan-hanqi.mjs                  # 全量重扫并写回 lines.json
 *   node scripts/scan-hanqi.mjs --merge          # 与现有 hanqi 块合并（新数据优先补空，旧数据保留）
 *   node scripts/scan-hanqi.mjs --no-detail      # 不逐条拉 /realtime（请求量最小，缺起讫站/站数）
 *   node scripts/scan-hanqi.mjs --out x.json     # 改输出（调试用）
 *
 * 注意：与 scan-lines.mjs 同属**数据生成器**（允许写文件）；两者各管各的块，互不覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.HQ_BASE || 'https://hanqizhihuichuxing.top/api/bus'

// 武汉锚点：与 src/utils/hanqi.js 的 WH_ANCHORS 保持一致（那边供运行时就近扫描用）
const ANCHORS = [
  [30.592, 114.305], // 汉口 / 江汉路
  [30.55, 114.35], // 武昌站
  [30.66, 114.42], // 青山
  [30.45, 114.18], // 沌口 / 汉阳
  [30.62, 114.05], // 蔡甸方向
  [30.7, 114.5], // 光谷 / 东湖高新
  [30.4, 114.3], // 汉南方向
]

// ---- 参数 ----
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}
const has = (name) => argv.includes('--' + name)
const MERGE = has('merge')
const NO_DETAIL = has('no-detail')
const CONCURRENCY = Math.max(1, Number(argOf('concurrency', 4)))
const DELAY = Math.max(0, Number(argOf('delay', 150)))
const OUT = path.resolve(argOf('out', 'src/data/lines.json'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** GET 汉奇接口，code===200 取 data，带重试 */
async function req(p, params) {
  const qs = new URLSearchParams(params).toString()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${p}?${qs}`, { signal: AbortSignal.timeout(15000) })
      const payload = await res.json()
      if (payload && payload.code === 200 && payload.data) return payload.data
      if (attempt === 2) return null
    } catch (e) {
      if (attempt === 2) return null
    }
    await sleep(600 * (attempt + 1))
  }
  return null
}

/** 简易并发池（同 scan-lines.mjs）：保持顺序收集结果，单条失败不中断整体 */
async function pool(items, worker, concurrency) {
  const out = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
      if (DELAY) await sleep(DELAY)
    }
  })
  await Promise.all(runners)
  return out
}

const fmt = (n) => String(n).padStart(4, ' ')
const t0 = Date.now()

// 1) 锚点 /nearby 合并去重 → 线路摘要
console.log(`锚点 ${ANCHORS.length} 个 /nearby 扫描（radius 6000）…`)
const seen = new Map()
let nDone = 0
await pool(ANCHORS, async ([la, ln]) => {
  const data = await req('/nearby', { lat: la, lng: ln, radius: 6000 })
  nDone++
  process.stdout.write(`\r  锚点 ${fmt(nDone)}/${fmt(ANCHORS.length)}`)
  for (const b of (data && data.buses) || []) {
    if (!b.lineId || !b.routeName) continue
    if (!seen.has(b.lineId)) {
      seen.set(b.lineId, {
        lineId: b.lineId,
        lineName: b.routeName,
        first: b.firstTime || '',
        last: b.lastTime || '',
        price: b.price || '',
        dirs: b.isBidirectional ? [0, 1] : [0],
        start: '',
        end: '',
        stops: 0,
      })
    } else if (b.isBidirectional) {
      // 另一锚点/另一方向见过 → 补双向标记
      const l = seen.get(b.lineId)
      if (!l.dirs.includes(1)) l.dirs = [0, 1]
    }
  }
  return true
}, 4)
process.stdout.write('\n')
const fresh = [...seen.values()]
console.log(`摘要命中 ${fresh.length} 条，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (!fresh.length) { console.error('一个锚点都没返回数据，疑似接口不可用，终止（不覆盖已落盘数据）'); process.exit(1) }

// 2) 逐条 /realtime 富化（起讫站/票价/站数；上行方向口径）
if (!NO_DETAIL) {
  let d = 0
  await pool(fresh, async (l) => {
    const data = await req('/realtime', { lineId: l.lineId })
    d++
    if (d % 10 === 0 || d === fresh.length) process.stdout.write(`\r  富化 ${fmt(d)}/${fmt(fresh.length)}`)
    if (!data) return
    l.start = data.startStation || ''
    l.end = data.endStation || ''
    l.stops = (data.stations || []).length
    if (data.price) l.price = String(data.price)
    if (data.firstTime) l.first = data.firstTime
    if (data.lastTime) l.last = data.lastTime
  }, CONCURRENCY)
  process.stdout.write('\n')
}

// 3) 与现有 hanqi 块合并（只补强不降级：新数据优先，旧数据补空 + 保留本轮没扫到的线）
let lines = fresh
const oldBlock = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'))
    return j && j.hanqi && Array.isArray(j.hanqi.lines) ? j.hanqi : null
  } catch (e) { return null }
})()
if (MERGE && oldBlock) {
  const map = new Map(oldBlock.lines.map((l) => [l.lineId, l]))
  for (const l of fresh) {
    const prev = map.get(l.lineId)
    if (!prev) { map.set(l.lineId, l); continue }
    const m = {
      ...prev, ...l,
      dirs: [...new Set([...(prev.dirs || []), ...(l.dirs || [])])].sort((x, y) => x - y),
      start: l.start || prev.start || '',
      end: l.end || prev.end || '',
      price: l.price || prev.price || '',
      first: l.first || prev.first || '',
      last: l.last || prev.last || '',
      stops: l.stops || prev.stops || 0,
    }
    map.set(l.lineId, m)
  }
  lines = [...map.values()]
  console.log(`合并旧块：旧 ${oldBlock.lines.length} 条 → 合并后 ${lines.length} 条`)
}
lines.sort((a, b) => String(a.lineName).localeCompare(String(b.lineName), 'zh'))

// 4) 写回 lines.json（只替换 hanqi 块，武汉公交部分原样保留）
let doc = {}
try { doc = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) {
  if (!NO_DETAIL || !fs.existsSync(OUT)) { /* 文件不存在时允许新建（只含 hanqi 块） */ }
}
doc.hanqi = {
  source: 'hanqizhihuichuxing.top /nearby 锚点扫描 + /realtime 富化',
  updated: new Date().toISOString(),
  count: lines.length,
  lines,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8')

const kb = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`\n写入 ${path.relative(process.cwd(), OUT)} 的 hanqi 块：${lines.length} 条，全文件 ${kb} KB，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('样例：' + lines.slice(0, 5).map((l) => `${l.lineName}(${l.start || '?'}→${l.end || '?'}, ${l.stops}站, dirs=${l.dirs.join('/')})`).join(' · '))
