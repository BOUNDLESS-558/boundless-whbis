/**
 * 非武汉公交集团线路采集器（数据源：高德公交信息接口）
 *
 * 背景：武汉公交系统除集团外还有蔡城 / 木兰 / 汉奇等独立营运主体，
 * 官方 customized.wuhanbus.com 只覆盖集团线路。历史版本曾接「汉奇智慧出行」
 * 小程序接口，但该接口现已要求签名（401），且用户明确要求统一改走高德。
 *
 * 两条采集链路（配额池互相独立，可分别跑）：
 *   1) 蔡城 C / 木兰 P：/v3/bus/linename?keywords=线路号（按号段逐号枚举）
 *   2) 汉奇：线路名是中文前缀（「汉奇K6路」「汉奇定制公交1号线」…），linename 按号
 *      查不到，改用 /v3/assistant/inputtips?datatype=busline 拿线路 POI id，
 *      再 /v3/bus/lineid?id=... 取完整站点 + 走向。lineid 与 linename 的日配额分开计算，
 *      linename 返回 10044 时汉奇链路仍可正常采集。
 *
 * 产出：
 *   1) src/static/foreign-lines.json   线路库（摘要，供 lineIndex 合并进检索池）
 *   2) src/static/lines/CCB01.json ... 站点 + 走向资产分片（结构与 bNN.json 一致）
 *      - 集团资产仍是 bNN.json；非集团按「公司缩写 + B + 数字」命名，互不影响
 *      - 站点 stopId 改写为 `${abbr}B${序号}`（高德原 BV... 存进 originId 备查）
 *
 * 只补强不降级：每次运行都先读回已有摘要与分片再合并，本次没命中的线路不会被删，
 * 配额耗尽 / 只跑单个公司 / 断点续跑都不会把已采数据冲掉。
 *
 * 用法：
 *   $env:AMAP_KEY="你的高德Web服务Key"
 *   node scripts/scan-foreign.mjs --dry             # 预览命中，不落盘
 *   node scripts/scan-foreign.mjs                  # 全量（C/P + 汉奇）
 *   node scripts/scan-foreign.mjs --hanqi-only     # 只跑汉奇（linename 配额耗尽时用）
 *   node scripts/scan-foreign.mjs --only C1,P2     # 只采指定号（C/P 链路）
 */
import fs from 'node:fs'
import path from 'node:path'

// companies.js 为前端 ESM，仓库 package.json 无 type:module：用 data: URL 载入（与 _loadRouteClean.mjs 同法）
const COMP_SRC = fs.readFileSync(new URL('../src/utils/companies.js', import.meta.url), 'utf8')
const COMP = await import('data:text/javascript;base64,' + Buffer.from(COMP_SRC).toString('base64'))

const KEY = process.env.AMAP_KEY
if (!KEY) {
  console.error('缺少高德 Web 服务 Key：请设置环境变量 AMAP_KEY（本地一次性采集用，不会入库）。')
  console.error('  PowerShell:  $env:AMAP_KEY="你的Key"')
  process.exit(2)
}
const HOST = 'https://restapi.amap.com'
const CITY = '武汉'
const LINES_OUT = path.resolve('src/static/foreign-lines.json')
const ASSET_DIR = path.resolve('src/static/lines')

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const DRY = argv.includes('--dry')
const HANQI_ONLY = argv.includes('--hanqi-only')
const ONLY = String(argOf('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const DELAY = Math.max(0, Number(argOf('delay', 1200)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 高德请求统一封装：10021/10003 限流退避，10044 日配额耗尽返回 null 交主流程停这条链路 */
async function amapGet(api, params) {
  const u = new URL(HOST + api)
  Object.entries({ key: KEY, output: 'json', ...params }).forEach(([k, v]) => u.searchParams.set(k, String(v)))
  for (let t = 0; t < 6; t++) {
    try {
      const j = await (await fetch(u, { signal: AbortSignal.timeout(15000) })).json()
      if (j.status === '1') return j
      if (j.infocode === '10000' && j.status === '0') return { buslines: [], tips: [] }
      if (j.infocode === '10044') return null
      await sleep(1000 + t * 700) // QPS / 频率 / 未知错误
    } catch (e) {
      await sleep(900 + t * 500)
    }
  }
  return { buslines: [], tips: [] } // 单号失败不阻断整体，下轮重跑可补
}

/** C/P 号段：按线路号查 linename */
async function queryByName(kw) {
  const j = await amapGet('/v3/bus/linename', { keywords: kw, city: CITY, extensions: 'all', citylimit: 'true' })
  return j === null ? null : (j.buslines || [])
}

/** 汉奇：先用线路 POI 搜索拿 id（inputtips 配额池独立） */
async function queryLineIds(kw) {
  const j = await amapGet('/v3/assistant/inputtips', { keywords: kw, city: CITY, citylimit: 'true', datatype: 'busline' })
  return j === null ? null : (j.tips || []).filter((t) => t && t.id).map((t) => ({ id: String(t.id), name: String(t.name || '') }))
}

/** 汉奇：按线路 POI id 取完整站点与走向（lineid 配额池独立于 linename） */
async function queryLineById(id) {
  const j = await amapGet('/v3/bus/lineid', { id, city: CITY, extensions: 'all' })
  return j === null ? null : (j.buslines || [])[0] || null
}

// ── 解析 ──
/**
 * 高德线路名 → 规范线路号。
 * C/P 等：「C1路(成功大道人民医院--成功大道公交停车场)」→ C1
 * 汉奇为中文前缀：「汉奇K6路(武昌火车站综合体--武汉火车站)」→ 汉奇K6；
 *   「汉奇定制公交1号线(...)」→ 汉奇定制公交1；「汉奇景景有约巴士」→ 汉奇景景有约。
 * 括号里的起讫站一律剥掉，线路类型后缀（路 / 号线 / 巴士 / 专线）去掉。
 */
function parseNo(name) {
  const head = String(name || '').split('(')[0].trim()
  if (!head) return null
  if (/^汉奇/.test(head)) {
    const no = head.replace(/(?:路|号线|巴士|专线)$/, '')
    return no ? { no, base: no } : null
  }
  const m = /^([A-Za-z]+\d+)(快|区间|夜行)?路?/.exec(head)
  if (!m) return null
  return { no: m[1].toUpperCase() + (m[2] || ''), base: m[1].toUpperCase() }
}

/** 高德原始线路名（去掉起讫站括号），作为检索别名写进摘要 */
function displayName(name) {
  return String(name || '').split('(')[0].trim()
}

function companyOf(busline, no) {
  const byName = COMP.companyKeyOfAmap(busline.company)
  if (byName !== 'JT') return byName
  return COMP.companyKeyOfNo(no)
}
function polyToFlat(s) {
  const out = []
  for (const seg of String(s || '').split(';')) {
    const [lng, lat] = seg.split(',')
    const a = parseFloat(lng), b = parseFloat(lat)
    if (isFinite(a) && isFinite(b)) out.push(a, b)
  }
  return out
}
function slimStops(busstops, abbr) {
  return (busstops || []).map((s, i) => {
    const [lng, lat] = String(s.location || '').split(',')
    return {
      stopNo: Number(s.sequence) || i + 1,
      stopId: `${abbr}B${String(i + 1).padStart(4, '0')}`,
      stopName: s.name || '',
      longitude: parseFloat(lng) || 0,
      latitude: parseFloat(lat) || 0,
      originId: s.id || '',
    }
  })
}
const fmtTime = (t) => {
  const s = String(t || '').replace(/\D/g, '')
  return s.length === 4 ? `${s.slice(0, 2)}:${s.slice(2)}` : ''
}

// 汉奇线路名种子：这些是 /v3/assistant/inputtips?datatype=busline 实测确认存在的线路名。
// 用「线路名」而非「线路号」当关键词，是汉奇能被查到的关键（写「汉奇1」会查无此线）。
const HANQI_SEEDS = [
  '汉奇K6路', '汉奇12路', '汉奇22号线',
  '汉奇定制公交1号线', '汉奇定制公交2号线', '汉奇定制公交3号线', '汉奇定制公交4号线',
  '汉奇景景有约巴士',
]

/** C/P 号段关键词（--only 可覆盖） */
function keywords() {
  if (ONLY.length) return ONLY
  const ks = []
  for (let i = 1; i <= 20; i++) ks.push('C' + i)
  for (let i = 1; i <= 130; i++) ks.push('P' + i)
  return ks
}

// ── 主流程 ──
const buslines = new Map() // 高德 lineId → busline（去重）

// 1) C/P 链路（linename）
if (!HANQI_ONLY) {
  const ks = keywords()
  console.log(`[C/P] 高德 linename：${ks.length} 个关键词，限速 ${DELAY}ms`)
  let over = false
  for (let i = 0; i < ks.length; i++) {
    const arr = await queryByName(ks[i])
    if (arr === null) { over = true; console.log('  [C/P] 日配额耗尽，跳过本链路（已采数据保留）'); break }
    for (const b of arr) if (b && b.id) buslines.set(String(b.id), b)
    if (i % 20 === 0 || i === ks.length - 1) process.stdout.write(`\r  已查 ${i + 1}/${ks.length}，去重方向 ${buslines.size}`)
    if (DELAY && !over) await sleep(DELAY)
  }
  process.stdout.write('\n')
} else {
  console.log('[C/P] --hanqi-only：跳过')
}

// 2) 汉奇链路（inputtips → lineid）
console.log(`[汉奇] 线路 POI + lineid：${HANQI_SEEDS.length} 个线路名，限速 ${DELAY}ms`)
const ids = new Map()
for (let i = 0; i < HANQI_SEEDS.length; i++) {
  const arr = await queryLineIds(HANQI_SEEDS[i])
  if (arr === null) { console.log('  [汉奇] inputtips 配额耗尽，停止'); break }
  for (const t of arr) if (/汉奇/.test(t.name)) ids.set(t.id, t)
  console.log(`  ${HANQI_SEEDS[i]} → ${arr.length} 个方向，累计 ${ids.size}`)
  if (DELAY) await sleep(DELAY)
}
console.log(`[汉奇] 待取详情的线路 POI：${ids.size} 个`)
let hi = 0
for (const [id] of ids) {
  const b = await queryLineById(id)
  hi++
  if (b && b.id) buslines.set(String(b.id), b)
  if (hi % 5 === 0 || hi === ids.size) console.log(`  详情 ${hi}/${ids.size}，累计方向 ${buslines.size}`)
  if (DELAY) await sleep(DELAY)
}

// 按线路号聚合；每个高德 busline 是一个方向
const grouped = new Map()
for (const b of buslines.values()) {
  const p = parseNo(b.name)
  if (!p) continue
  // 只收非集团号段（C / P / 汉奇），集团线路继续由 lines.json + bNN 资产负责
  if (COMP.companyKeyOfNo(p.no) === 'JT') continue
  const abbr = companyOf(b, p.no)
  const g = grouped.get(p.no) || { no: p.no, abbr, display: displayName(b.name), dirs: [] }
  g.dirs.push(b)
  grouped.set(p.no, g)
}

// 方向判定：同一线路号两条走向，起点字典序小者作上行(0)，另一条作下行(1)
const lines = []
const shards = new Map()
for (const g of grouped.values()) {
  const abbr = g.abbr
  const sorted = g.dirs.slice().sort((a, b) => String(a.start_stop || '').localeCompare(String(b.start_stop || '')))
  const row = { no: g.no, dirs: {} }
  const picked = sorted.slice(0, 2)
  picked.forEach((b, idx) => {
    const stops = slimStops(b.busstops, abbr)
    if (stops.length < 2) return
    const route = polyToFlat(b.polyline)
    row.dirs[String(idx)] = {
      base: {
        startStop: b.start_stop || '', endStop: b.end_stop || '',
        earlyHour: fmtTime(b.start_time), lastHour: fmtTime(b.end_time),
        price: b.basic_price || '', lineName: b.name || g.no,
      },
      stops,
      route,
      snapped: !!route.length,
      source: 'amap',
      algo: 100,
      company: abbr,
    }
  })
  if (!Object.keys(row.dirs).length) continue
  const first = picked[0] || {}
  lines.push({
    no: g.no,
    name: g.display !== g.no ? g.display : g.no,
    companyKey: abbr,
    org: (COMP.COMPANIES[abbr] || {}).name || '',
    start: row.dirs['0'] ? row.dirs['0'].base.startStop : '',
    end: row.dirs['0'] ? row.dirs['0'].base.endStop : '',
    early: row.dirs['0'] ? row.dirs['0'].base.earlyHour : '',
    last: row.dirs['0'] ? row.dirs['0'].base.lastHour : '',
    price: row.dirs['0'] ? row.dirs['0'].base.price : '',
    stops: row.dirs['0'] ? row.dirs['0'].stops.length : 0,
    dirs: Object.keys(row.dirs).map(Number),
    code: g.no,
    status: '营运',
    sourceType: 'amap',
    realtime: false, // 高德无实时车辆，前端须标注「静态数据」
    distance: first.distance || '',
  })
  const shard = COMP.foreignShardOf(g.no, abbr)
  if (!shards.has(shard)) shards.set(shard, { lines: {} })
  shards.get(shard).lines[g.no] = row
}

// ── 只补强不降级：与已有摘要 / 分片合并 ──
let prev = { lines: [] }
try { prev = JSON.parse(fs.readFileSync(LINES_OUT, 'utf8')) } catch (e) { /* 首次运行 */ }
const merged = new Map((prev.lines || []).map((l) => [l.no, l]))
for (const l of lines) {
  // 本次没拿到站点的不覆盖旧记录
  const old = merged.get(l.no)
  if (old && old.stops > 0 && !l.stops) continue
  merged.set(l.no, l)
}
const finalLines = [...merged.values()].sort((a, b) => a.no.localeCompare(b.no, 'zh', { numeric: true }))
const byCompany = {}
for (const l of finalLines) byCompany[l.companyKey || 'JT'] = (byCompany[l.companyKey || 'JT'] || 0) + 1

console.log(`\n本次命中 ${lines.length} 条：${JSON.stringify(Object.fromEntries(lines.reduce((m, l) => m.set(l.companyKey, (m.get(l.companyKey) || 0) + 1), new Map())))}`)
console.log('样本：', lines.slice(0, 5).map((l) => `${l.no}(${l.start}→${l.end}, ${l.stops}站)`).join(' | '))
console.log(`合并后线路库 ${finalLines.length} 条：${JSON.stringify(byCompany)}`)
console.log('资产分片：', [...shards.keys()].sort().join(', '))

if (DRY) { console.log('\n[dry] 未写入任何文件'); process.exit(0) }
if (!lines.length) { console.log('\n本次零命中，不写盘（保护已有数据）'); process.exit(0) }

fs.writeFileSync(LINES_OUT, JSON.stringify({
  city: '420100', cityName: '武汉', updated: new Date().toISOString(),
  source: '高德地图 /v3/bus/linename + /v3/bus/lineid（离线采集，运行时零调用）',
  note: '非武汉公交集团线路；高德不提供实时车辆与发车计划，realtime=false 的线路前端须标注静态数据',
  companies: byCompany, count: finalLines.length, lines: finalLines,
}, null, 2) + '\n', 'utf8')
fs.mkdirSync(ASSET_DIR, { recursive: true })
for (const [name, shard] of shards) {
  const fp = path.join(ASSET_DIR, name + '.json')
  let prevShard = { lines: {}, version: 1 }
  try { prevShard = JSON.parse(fs.readFileSync(fp, 'utf8')) } catch (e) { /* 新分片 */ }
  fs.writeFileSync(fp, JSON.stringify({
    updated: new Date().toISOString(),
    version: Math.max(Number(prevShard.version) || 1, 1),
    lines: { ...(prevShard.lines || {}), ...shard.lines },
  }) + '\n', 'utf8')
}
console.log(`\n已写入 ${LINES_OUT}（${finalLines.length} 条）与 ${shards.size} 个资产分片`)
process.exit(0)
