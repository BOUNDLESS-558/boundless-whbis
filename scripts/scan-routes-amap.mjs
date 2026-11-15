/**
 * 线路资产采集器（A）：高德官方公交轨迹，离线批量落盘。
 *
 * 这是 A+B 混合里的「A（更优源）」：高德公交信息查询接口 /v3/bus/linename 一次返回
 *   - polyline   : 公交公司上报的真实走向（沿固定线路、走专用道，不存在「驾车路网绕街区」问题）
 *   - busstops   : 官方站点序列（可顺带修正上游 /line 的「整段重复」病灶）
 * 用官方轨迹替换 B（OSRM 驾车近似）的几何，根治截图里那种规整矩形方框。
 *
 * 关键约束：
 *   - Key 通过环境变量 AMAP_KEY（含签名 AMAP_SECRET）提供，不进前端代码、不提交仓库；
 *     CI 下由仓库 Secrets 注入（见 .github/workflows/daily-collect.yml），每 6h 自动跑本步。
 *   - 坐标口径：高德返回的是 GCJ-02，与上游 /line、资产落盘口径一致 → 直接存，无需转换。
 *   - 只写 source:'amap' 的行；已为 amap 的行默认跳过（--force 才重写）。绝不删除 B 的结果：
 *     高德没收录的线路（D/K 定制线等）A 不写，原 OSRM 行保持不动。
 *
 * 用法：
 *   $env:AMAP_KEY="你的高德Web服务Key"
 *   node scripts/scan-routes-amap.mjs --only 337,909,273      # 小样本先验证字段/覆盖率
 *   node scripts/scan-routes-amap.mjs                          # 全量（按免费额度限速）
 *   node scripts/scan-routes-amap.mjs --city 武汉 --delay 1100 # 控制 QPS（免费 1000~5000/日）
 *   node scripts/scan-routes-amap.mjs --retry-unmatched         # 只重试未命中的线，done 的不动
 *   node scripts/scan-routes-amap.mjs --only-changed scripts/.changed-lines.txt
 *        # 增量重拉：仅对 scan-routes.mjs --detect-changes 登记的「站点变化的线路」刷新高德走向
 *        # （配合 auto-collect 每 6h 跑：上游站点一变，本步自动重拉最新走向）
 *
 * 增量说明：auto-collect 默认（非全量）会先跑 `scan-routes.mjs --detect-changes` 探测
 * 上游 /line 站点变化、写 .changed-lines.txt，再以此文件驱动本步只重拉变化线路，
 * 既实现「线路更新后获取最新走向」，又把高德日配额消耗压到「变化线路」量级。
 *
 * 断点续跑：scripts/.amap-progress.json 记录每条线的采集结果（done / partial /
 * no-match / not-found），已记录的线直接跳过，高德未收录 / 方向匹配不上的也不会每轮重打。
 * 接口失败、/line 探测失败都不记账，下一轮自动重试；初始台账会自动从现有资产回填
 * 「所有方向已是 amap」的线路。
 *
 * 主链路 linename 日配额耗尽(10044) 时自动切备用链路 inputtips → lineid（配额池独立）。
 * ⚠ 备用链路对集团纯数字线路号覆盖率低（inputtips 是模糊搜索，常只给 408路 / 轨道交通4号线
 * 这类干扰项），所以它查不到精确 POI 时返回 null 而不记账，次日主链路额度恢复后仍会重试。
 * 两条链路配额都耗尽才提前停机。
 *
 * 不写 Key 直接退出并提示。
 */
import fs from 'node:fs'
import path from 'node:path'
import RC from './_loadRouteClean.mjs'

const { cleanStops, pointsOf, simplify, toFlat, shardOf } = RC

const KEY = process.env.AMAP_KEY
const SECRET = process.env.AMAP_SECRET || ''
if (!KEY) {
  console.error('缺少高德 Web 服务 Key：请先设置环境变量 AMAP_KEY（本地一次性采集用，不会入库）。')
  console.error('  PowerShell:  $env:AMAP_KEY="你的Key"')
  console.error('  bash:        export AMAP_KEY="你的Key"')
  console.error('若 Key 开启了「签名校验」，还需设置 AMAP_SECRET（Key 详情里的安全密钥），否则会报 10001。')
  process.exit(2)
}
// 高德签名：所有参数（不含 key/sig）按名升序拼成 k=v&... 再追加安全密钥，MD5 小写。
// 仅当平台=「Web服务」且开启签名校验时才需要；不提供 SECRET 则按无签名方式请求。
import crypto from 'node:crypto'
function amapSig(params) {
  if (!SECRET) return ''
  const keys = Object.keys(params).filter((k) => k !== 'key' && k !== 'sig').sort()
  const str = keys.map((k) => `${k}=${params[k]}`).join('&') + SECRET
  return crypto.createHash('md5').update(str).digest('hex')
}

// ── 上游 /line（复用 scan-routes.mjs 的协议，拿清洗后的站点明细 + base）──
const BASE = process.env.SCAN_BASE || 'https://customized.wuhanbus.com/gps-resapi/wechat/bus'
const CITY = '420100'
const HEADERS = { 'Content-Type': 'application/json', openId: 'wx_openid_dev_001' }
const COMMON = {
  cityCode: CITY, xiaomaAppId: 'wxaa1d01cdc96a2c0c', appKey: 'A0CADFE6F3B914A2',
  appType: 4, codeType: 1, channelId: 23000003, appSource: 2,
}
const AMAP = 'https://restapi.amap.com/v3/bus/linename'
const AMAP_ALGO = 100 // 高于 B 的任何 VERSION，标识官方轨迹

// ── 参数 ──
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}
const has = (name) => argv.includes('--' + name)
const LIB = path.resolve(argOf('lib', 'src/static/lines.json'))
const OUT = path.resolve(argOf('out', 'src/static/lines'))
const ONLY = String(argOf('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const CITYNAME = argOf('city', '武汉')
const DELAY = Math.max(0, Number(argOf('delay', 1100)))
// 0 = 不限；CI 里可分批跑，避免单次 job 过长。只统计「实际处理」的线路，跳过的不算。
const MAX_LINES = Math.max(0, Number(argOf('max-lines', 0)))
// GitHub Actions 日志是行缓冲，\r 刷新进度会糊成一长行；CI 下改用逐行输出
const CI_LOG = has('ci-log') || !!process.env.GITHUB_ACTIONS
const FORCE = has('force')
const DRY = has('dry')
// 增量重拉：只读 scan-routes.mjs --detect-changes 产出的「变化线路清单」，对这些线强制重拉高德走向
const ONLY_CHANGED = argOf('only-changed', '')
// 只重试「未命中」的线路（partial / no-match / not-found），已 done 的不动，比 --force 省额度
const RETRY_UNMATCHED = has('retry-unmatched')
// 采集进度台账：记录每条线已尝试的结果，避免「高德未收录 / 方向未匹配」的线路每轮重复消耗日配额。
// 单独放 scripts/ 下，不进 src/static（也就不会进 H5 产物）。
const PROGRESS = path.resolve(argOf('progress', 'scripts/.amap-progress.json'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 分片读写（与 scan-routes.mjs 同结构，独立维护，避免互相耦合）──
const SHARDS = new Map()
const dirty = new Set()
const shardPath = (key) => path.join(OUT, key + '.json')
function loadShard(key) {
  if (SHARDS.has(key)) return SHARDS.get(key)
  let data = { updated: '', version: 0, lines: {} }
  try {
    const raw = fs.readFileSync(shardPath(key), 'utf8')
    const j = JSON.parse(raw)
    if (j && j.lines && typeof j.lines === 'object') data = j
  } catch (e) { /* 不存在/损坏：空分片 */ }
  SHARDS.set(key, data)
  return data
}
function rowOf(no, dir) {
  // 必须与 putRow 用同一个分片键：以前这里写成 String(no)，读的是不存在的 "4.json"，
  // 导致「已是 amap 就跳过」恒不成立 → 每轮把全部线路重打一遍高德并重新 probe /line。
  const shard = loadShard(shardOf(no))
  const line = shard.lines[String(no)]
  return line && line.dirs && line.dirs[String(dir)]
}
function putRow(no, dir, row) {
  const key = shardOf(no)
  const shard = loadShard(key)
  const k = String(no)
  if (!shard.lines[k]) shard.lines[k] = { no: k, dirs: {} }
  shard.lines[k].dirs[String(dir)] = row
  dirty.add(key)
}
let writeBytes = 0
function flushDirty() {
  if (!dirty.size) return
  const keys = [...dirty]
  dirty.clear()
  for (const key of keys) {
    const shard = SHARDS.get(key)
    if (!shard) continue
    shard.updated = new Date().toISOString()
    const text = JSON.stringify(shard) + '\n'
    writeBytes += Buffer.byteLength(text)
    if (!DRY) fs.writeFileSync(shardPath(key), text, 'utf8')
  }
}
let flushTail = Promise.resolve()
function requestFlush() {
  flushTail = flushTail.then(() => flushDirty()).catch((e) => console.error('[flush]', e && e.message))
  return flushTail
}

// ── 采集进度台账（去重）──
// done      = 该线所有方向都已是 amap
// partial   = 部分方向命中 amap，其余方向尽力后仍无法匹配
// no-match  = 高德有该线数据，但起讫站名匹配不上任何方向
// not-found = 高德确认未收录（status=0 / infocode=10000）
// 接口失败(null)、/line 探测失败、日配额耗尽 → 不记账，下一轮自动重试。
const progress = { updated: '', version: 1, lines: {} }
let progressSnapshot = ''   // 幂等：内容没变就不重写文件，避免 CI 每轮产生「只改时间戳」的空提交
function loadProgress() {
  try {
    const j = JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))
    if (j && j.lines && typeof j.lines === 'object') Object.assign(progress.lines, j.lines)
  } catch (e) { /* 首次运行：空台账 */ }
  progressSnapshot = JSON.stringify(progress.lines)
}
function saveProgress() {
  if (DRY) return
  const snapshot = JSON.stringify(progress.lines)
  if (snapshot === progressSnapshot) return
  progressSnapshot = snapshot
  progress.updated = new Date().toISOString()
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true })
  fs.writeFileSync(PROGRESS, JSON.stringify(progress) + '\n', 'utf8')
}
function mark(no, state) { progress.lines[String(no)] = state }
function isLogged(no) {
  if (FORCE) return false
  const s = progress.lines[String(no)]
  if (!s) return false
  // --retry-unmatched：只放行未完成的，done 的绝不重打
  return !(RETRY_UNMATCHED && s !== 'done')
}

// ── /line 探测（仅当现有资产缺该方向站点时用来补 stops/base）──
async function probe(code, dir) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + '/line', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ ...COMMON, lineCode: `${CITY}-${code}-${dir}` }),
        signal: AbortSignal.timeout(15000),
      })
      const payload = await res.json()
      if (payload && payload.success === true && payload.msg && payload.msg.code === '20000') {
        const data = payload.data || {}
        return { ok: true, base: data.lineDetailBaseDto || {}, stops: data.stopDetailList || [] }
      }
      if (attempt === 2) return { ok: false }
    } catch (e) { if (attempt === 2) return { ok: false } }
    await sleep(600 * (attempt + 1))
  }
  return { ok: false }
}

// 精简站点：保留展示与渲染必需字段，砍掉无用大字段（与 scan-routes.mjs 的 slimStops 一致）
function slimStops(stops) {
  return (stops || []).map((s) => {
    const o = {
      stopNo: s.stopNo, stopId: s.stopId, stopName: s.stopName,
      longitude: +s.longitude, latitude: +s.latitude,
    }
    if (s.stopType !== undefined) o.stopType = s.stopType
    if (s.transferInfos && s.transferInfos.length) {
      const t = s.transferInfos.map((x) => ({ subwayLineNo: x.subwayLineNo })).filter((x) => x.subwayLineNo)
      if (t.length) o.transferInfos = t
    }
    return o
  })
}

// ── 高德公交信息查询 ──
// linename 日配额耗尽后置位 → 自动切备用链路；备用链路也耗尽才停机。
let QUOTA_EXHAUSTED = false
let FALLBACK_EXHAUSTED = false

/** 通用 GET（含可选签名）；失败返回 null */
async function amapGet(pathname, params) {
  const p = { ...params, key: KEY, output: 'json' }
  const sig = amapSig(p)
  const qs = Object.entries(p)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + (sig ? `&sig=${sig}` : '')
  try {
    const res = await fetch(`https://restapi.amap.com${pathname}?${qs}`, { signal: AbortSignal.timeout(15000) })
    return await res.json()
  } catch (e) { return null }
}
function isQuotaOut(j) {
  return !!(j && (j.infocode === '10044' || /DAILY_QUERY_OVER_LIMIT/i.test(j.info || '')))
}
/** 「337路(...)」这类 POI 名是否就是该线路号；避免把 4路 匹配到 40路 / 地铁4号线 */
function tipMatchesNo(name, no) {
  const s = String(name || '').trim()
  const n = String(no)
  if (!s.startsWith(n)) return false
  return /^(路|线|\(|（|\s|$)/.test(s.slice(n.length))
}

/**
 * 备用链路：/v3/assistant/inputtips?datatype=busline 拿线路 POI id，
 * 再 /v3/bus/lineid?id=... 取完整走向。两个接口与 linename 的日配额分开计算
 * （实测 linename 返回 10044 时这条链路仍可用，见 scripts/scan-foreign.mjs 汉奇采集）。
 * lineid 返回的 busline 同样含 polyline / start_stop / end_stop / busstops，
 * 结构与 linename 一致 → 直接喂给 matchBusline，主循环无需改动。
 */
async function queryAmapFallback(lineNo) {
  const t = await amapGet('/v3/assistant/inputtips', {
    keywords: String(lineNo), city: CITYNAME, citylimit: 'true', datatype: 'busline',
  })
  if (isQuotaOut(t)) { FALLBACK_EXHAUSTED = true; return null }
  if (!t || t.status !== '1') return null
  const ids = (t.tips || []).filter((x) => x && x.id && tipMatchesNo(x.name, lineNo)).slice(0, 4)
  // inputtips 是模糊搜索，对集团纯数字号经常只返回「408路 / 轨道交通4号线」这类干扰项，
  // 甚至 0 条。查不到精确 POI 一律返回 null（= 本轮无法判定，不记账），
  // 等 linename 次日额度恢复后用主链路重试；绝不能记成 not-found 把线路永久跳过。
  if (!ids.length) return null
  const out = []
  for (const x of ids) {
    const j = await amapGet('/v3/bus/lineid', { id: String(x.id), city: CITYNAME, extensions: 'all' })
    if (isQuotaOut(j)) { FALLBACK_EXHAUSTED = true; return null }
    const b = j && Array.isArray(j.buslines) && j.buslines[0]
    if (b && b.polyline) out.push(b)
  }
  return out.length ? out : null
}

async function queryAmap(lineNo) {
  if (QUOTA_EXHAUSTED) return queryAmapFallback(lineNo)
  const params = {
    key: KEY, city: CITYNAME, keywords: String(lineNo),
    extensions: 'all', output: 'json', citylimit: 'true',
  }
  const sig = amapSig(params)
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + (sig ? `&sig=${sig}` : '')
  const url = `${AMAP}?${qs}`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      const j = await res.json()
      if (j && j.status === '1' && Array.isArray(j.buslines)) return j.buslines
      if (j && j.infocode === '10000' && j.status === '0') return [] // 查无此线
      if (isQuotaOut(j)) {
        if (!QUOTA_EXHAUSTED) {
          QUOTA_EXHAUSTED = true
          console.error(`\n  [amap] linename 日配额耗尽（${j.infocode}），自动切换备用链路 inputtips → lineid，本轮继续采集。`)
        }
        return queryAmapFallback(lineNo)
      }
      // 额度/频率类报错先提示但不死循环
      if (j && (j.infocode === '10003' || j.infocode === '10004' || j.infocode === '10010' || j.infocode === '10002')) {
        console.error(`  [amap] ${lineNo} 受限 ${j.infocode}，${attempt < 2 ? '退避重试' : '跳过'}`)
      }
      if (attempt === 2) return null
    } catch (e) { if (attempt === 2) return null }
    await sleep(800 * (attempt + 1))
  }
  return null
}

// 把高德 polyline 字符串（"lng,lat;lng,lat;..."，GCJ-02）解析为点列
function parsePolyline(s) {
  if (!s || typeof s !== 'string') return []
  const out = []
  for (const seg of s.split(';')) {
    const [lng, lat] = seg.split(',')
    const lo = parseFloat(lng), la = parseFloat(lat)
    if (!isFinite(lo) || !isFinite(la)) continue
    out.push({ lat: la, lng: lo })
  }
  return out
}

// 按起讫站名给方向匹配高德 busline：返回 { polyline, busstops, reversed }
function matchBusline(buslines, firstStop, lastStop) {
  if (!buslines || !buslines.length) return null
  const norm = (s) => (s || '').replace(/\s|站$/g, '')
  const f = norm(firstStop), l = norm(lastStop)
  let best = null, bestScore = -1
  for (const bl of buslines) {
    const s = norm(bl.start_stop), e = norm(bl.end_stop)
    let score = -1, reversed = false
    if (s && e) {
      if (f && f.includes(s) && l && l.includes(e)) score = 2
      else if (f && f.includes(e) && l && l.includes(s)) { score = 2; reversed = true }
      else if ((f && s.includes(f) && l && e.includes(l))) score = 1
      else if ((f && e.includes(f) && l && s.includes(l))) { score = 1; reversed = true }
    }
    if (score > bestScore) { bestScore = score; best = { bl, reversed } }
  }
  if (!best || bestScore < 1 || !best.bl.polyline) return null
  return { polyline: best.bl.polyline, busstops: best.bl.busstops || [], reversed: best.reversed, id: best.bl.id }
}

// ── 主流程 ──
if (!fs.existsSync(LIB)) { console.error('找不到线路库：' + LIB); process.exit(1) }
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const lines = (lib.lines || []).filter((l) => l.status !== '停运' && l.stops)
const todo = ONLY.length ? lines.filter((l) => ONLY.includes(String(l.no))) : lines

// 增量重拉：只处理 scan-routes.mjs --detect-changes 登记的「站点变化的线路」
let changedLines = null
if (ONLY_CHANGED) {
  try {
    const txt = fs.readFileSync(ONLY_CHANGED, 'utf8')
    changedLines = new Set(txt.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))
  } catch (e) { changedLines = new Set() }
  if (changedLines.size === 0) {
    console.log(`（--only-changed ${ONLY_CHANGED} 无变化线路，跳过高德重拉）`)
    process.exit(0)
  }
}
const todoFinal = changedLines ? todo.filter((l) => changedLines.has(String(l.no))) : todo
if (!DRY) fs.mkdirSync(OUT, { recursive: true })

const stats = { total: todoFinal.length, done: 0, skipped: 0, matched: 0, probe: 0,
  amapMiss: 0, dirMiss: 0, fallback: 0 }

// 台账初始化：首次运行时按现有资产回填「所有方向已是 amap」的线路，
// 这样历史采集成果也进入台账，不会被重复请求。
loadProgress()
let seeded = 0
for (const l of lines) {   // 用全量库回填，而非本轮 todo：--only 小样本也能记全历史成果
  const no = String(l.no)
  if (progress.lines[no]) continue
  const ds = (l.dirs && l.dirs.length ? l.dirs : [0]).map(Number)
  if (ds.every((d) => { const r = rowOf(no, d); return r && r.source === 'amap' })) {
    mark(no, 'done')
    seeded++
  }
}
saveProgress()
const loggedBefore = Object.keys(progress.lines).length
console.log(`高德采集：候选 ${todoFinal.length} 条线${changedLines ? '（增量重拉）' : ''}，城市 ${CITYNAME}，间隔 ${DELAY}ms${DRY ? '（dry，不落盘）' : ''}`)
console.log(`进度台账 ${path.relative(process.cwd(), PROGRESS)}：已记录 ${loggedBefore} 条线（本次回填 ${seeded} 条）`)

let doneCount = 0
for (const l of todoFinal) {
  if (FALLBACK_EXHAUSTED) break
  if (MAX_LINES && doneCount >= MAX_LINES) {
    console.log(`\n已达本轮上限 --max-lines ${MAX_LINES}，提前结束；台账已落盘，下轮自动续采。`)
    break
  }
  const no = String(l.no)
  const dirs = (l.dirs && l.dirs.length ? l.dirs : [0]).map(Number)

  // 增量重拉：清单内线路强制重拉（无视台账 / 已 amap），实现「线路更新后获取最新走向」
  if (changedLines) {
    // 不跳过，直接走下方高德查询
  } else {
    // 台账命中即跳过：包括「高德未收录」「方向未匹配」这些过去每轮都会重打的线路
    if (isLogged(no)) { stats.skipped++; continue }

    // 双保险：台账被手删时，资产本身已全是 amap 的线也不重打
    if (!FORCE && dirs.every((d) => { const r = rowOf(no, d); return r && r.source === 'amap' })) {
      mark(no, 'done')
      saveProgress()
      stats.skipped++
      continue
    }
  }

  const buslines = await queryAmap(no)
  if (FALLBACK_EXHAUSTED) break           // 两条链路都耗尽：不记账，下一轮重试
  if (buslines === null) { stats.amapMiss++; continue } // 接口失败：保留现有 B 行，下一轮重试
  if (!buslines.length) {                              // 高德确认未收录：记账，以后不再问
    stats.amapMiss++
    mark(no, 'not-found')
    saveProgress()
    continue
  }

  let lineMatched = false
  let unresolved = 0      // 该线仍未落 amap 的方向数
  let transient = false   // /line 探测失败属临时故障 → 不记账，下轮重试
  for (const d of dirs) {
    const prev = rowOf(no, d)
    // 增量重拉时强制重写（含原已 amap 的方向）；否则遵守「amap 不覆盖」
    if (!changedLines && !FORCE && prev && prev.source === 'amap') { stats.skipped++; continue }

    // 取该方向的清洗后站点（优先复用现有资产，缺则补 /line）
    let base, rawStops
    if (prev && Array.isArray(prev.stops) && prev.stops.length >= 2) {
      base = prev.base || {}
      rawStops = prev.stops
    } else {
      const r = await probe(l.code || no, d)
      if (!r.ok) { stats.probe++; transient = true; unresolved++; continue }
      base = r.base
      rawStops = r.stops
      stats.probe++
    }
    if (!Array.isArray(rawStops) || rawStops.length < 2) { stats.dirMiss++; unresolved++; continue }
    const { stops } = cleanStops(rawStops)
    if (stops.length < 2) { stats.dirMiss++; unresolved++; continue }

    // 用清洗后站点的首末站名匹配高德方向
    let firstStop = stops[0].stopName
    let lastStop = stops[stops.length - 1].stopName
    let m = matchBusline(buslines, firstStop, lastStop)
    if (!m) {
      // 回退：cleanStops 按 stopNo 排序可能把终点打乱（211 dir0 把「育才实验学校」
      // 排到「湖大知行学院」之后），改用清洗前物理首末站再试一次
      firstStop = (rawStops[0] && rawStops[0].stopName) || firstStop
      lastStop = (rawStops[rawStops.length - 1] && rawStops[rawStops.length - 1].stopName) || lastStop
      m = matchBusline(buslines, firstStop, lastStop)
    }
    if (!m) { stats.dirMiss++; stats.fallback++; unresolved++; continue }

    const pts = parsePolyline(m.polyline)
    if (pts.length < 2) { stats.dirMiss++; stats.fallback++; unresolved++; continue }
    // 高德 polyline 本就优化过，只做极轻抽稀去掉浮点抖动，不丢走向细节
    // reversed=true 表示该方向的起讫站与高德 busline 相反（往返同路的线路，高德常只给
    // 一条 polyline，两个方向都会匹配到它）。必须反转点序，否则上下行几何同向重合，
    // 「全部」视角里后画的玫红会整条盖掉青蓝，方向箭头也反了。
    const route = simplify(pts, 0.00001)
    const dirRoute = m.reversed ? route.slice().reverse() : route
    if (dirRoute.length < 2) { stats.dirMiss++; stats.fallback++; unresolved++; continue }

    putRow(no, d, {
      base,
      stops: slimStops(stops),
      route: toFlat(dirRoute),
      snapped: true,
      source: 'amap',
      algo: AMAP_ALGO,
      amap: { name: (m.busstops && buslines[0] && buslines[0].name) || null, reversed: m.reversed, id: m.id || null },
      clean: prev && prev.clean,
    })
    stats.matched++
    lineMatched = true
  }

  // 记账：临时故障不记，下一轮重试；否则按结果记入台账，本轮及后续都不再重打。
  // 每条线立即落盘，中途 Ctrl+C / 取消也只丢当前这一条，不会成片重复采集。
  if (!transient) { mark(no, unresolved === 0 ? 'done' : (lineMatched ? 'partial' : 'no-match')); saveProgress() }

  if (lineMatched) stats.done++
  doneCount++
  if (doneCount % 25 === 0 || doneCount === todo.length) {
    const msg = `  已处理 ${doneCount}/${todo.length}（amap 命中 ${stats.matched} 方向，未收录 ${stats.amapMiss}）`
    if (CI_LOG) console.log(msg)
    else process.stdout.write(`\r${msg}`)
    await requestFlush()
    saveProgress()
  }
  if (DELAY) await sleep(DELAY)
}
await flushTail
flushDirty()
saveProgress()
if (!CI_LOG) process.stdout.write('\n')

const tally = {}
for (const s of Object.values(progress.lines)) tally[s] = (tally[s] || 0) + 1
const files = [...SHARDS.keys()].filter((k) => !DRY && fs.existsSync(shardPath(k)))
console.log(`\n完成：写入 amap 方向 ${stats.matched} 个（覆盖线路 ${stats.done} 条），跳过 ${stats.skipped}`)
console.log(`高德未收录 ${stats.amapMiss} 条线（保留 OSRM 兜底），方向未匹配 ${stats.dirMiss}，补 /line ${stats.probe}`)
console.log(`分片 ${files.length} 个，本次写出 ${(writeBytes / 1024).toFixed(1)} KB${DRY ? '（dry 未落盘）' : ''}`)
console.log(`进度台账 ${path.relative(process.cwd(), PROGRESS)}：共 ${Object.keys(progress.lines).length} 条线 ` +
  `(done ${tally.done || 0} / partial ${tally.partial || 0} / no-match ${tally['no-match'] || 0} / not-found ${tally['not-found'] || 0})`)
if (FALLBACK_EXHAUSTED) console.log('主链路与备用链路配额均耗尽，提前停机；未处理的线路未记账，次日 0 点后重跑自动续采。')
else if (QUOTA_EXHAUSTED) console.log('本轮 linename 配额耗尽，已自动切换备用链路 inputtips → lineid 继续采集。')
console.log('提示：未命中 amap 的方向仍由 scan-routes.mjs 的 OSRM 几何兜底，无需手动处理；如需重试未命中线路用 --retry-unmatched。')
process.exit(0)
