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
 *     CI 下由仓库 Secrets 注入（见 .github/workflows/daily-collect.yml），每 2h 自动跑本步。
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
 *   node scripts/scan-routes-amap.mjs --force                   # 全量强制重拉（跳过进度台账，每线每方向重新获取）
 *   node scripts/scan-routes-amap.mjs --only-changed scripts/.changed-lines.txt
 *        # 增量重拉：仅对 scan-routes.mjs --detect-changes 登记的「站点变化的线路」刷新高德走向
 *        # （本地调试用；CI 下 auto-collect 已改为 --force 全量重拉，不再走此增量模式）
 *
 * 全量重拉说明：auto-collect 每 2h 跑一次，高德步骤使用 --force 跳过进度台账，
 * 对整个武汉公交系统的每条线路、每个方向重新拉取高德官方轨迹与站点数据，
 * 确保站点信息始终与上游保持一致。高德日配额（1000~5000/日）是主要约束：
 * 全量约 1000+ 条线 × 2 方向 ≈ 2000 次请求，配额耗尽时自动切备用链路
 * inputtips → lineid（配额池独立），两条链路都耗尽才提前停机。
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
import { validateStopsAgainstPolyline, routeToPoly } from './_validate.mjs'

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
const LIB = path.resolve(argOf('lib', 'src/static/lines/lines.json'))
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
// 补齐模式：只重采「source=amap 但站点仍是集团站」的方向（高德日配额耗尽时留下的半成品），
// 跳过已换成高德站的线路，把每日有限配额集中在待补数据上；供 CI 每轮增量补齐。
const BACKFILL_STOPS = has('backfill-stops')
// 采集前先复校验：把台账里标 done 但几何校验不过的线撤销，让本轮重拉
const VALIDATE_DONE = has('validate-done')
// 纯校验模式：不发任何请求，只扫现有资产并报告（可配合 --unmark-stale 清台账）
const VALIDATE_ONLY = has('validate-only')
// 增量重拉：只读 scan-routes.mjs --detect-changes 产出的「变化线路清单」，对这些线强制重拉高德走向
const ONLY_CHANGED = argOf('only-changed', '')
// 只重试「未命中」的线路（partial / no-match / not-found），已 done 的不动，比 --force 省额度
const RETRY_UNMATCHED = has('retry-unmatched')
// 跳过 linename 主链路，直接走备用链路 inputtips → lineid（两个接口日配额独立池，
// linename 耗尽时用此模式继续；也可用于全量重跑时绕过 100 次/日的 linename 瓶颈）。
const USE_LINEID = has('use-lineid')
// 采集进度台账：记录每条线已尝试的结果，避免「高德未收录 / 方向未匹配」的线路每轮重复消耗日配额。
// 单独放 scripts/ 下，不进 src/static（也就不会进 H5 产物）。
const PROGRESS = path.resolve(argOf('progress', 'scripts/.amap-progress.json'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 分片读写（与 scan-routes.mjs 同结构，独立维护，避免互相耦合）──
const SHARDS = new Map()
const dirty = new Set()
// 集团分片统一落在 jt/ 子目录（与运行时 lineAsset.js 的 shardRel 对齐）
const shardPath = (key) => path.join(OUT, 'jt', key + '.json')
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
// 站点是否已是高德（BV... 前缀）：backfill 用它区分「已转换 / 待补」方向
function isAmapStops(row) {
  return !!(row && Array.isArray(row.stops) && row.stops.length >= 2 && /^BV/.test(String(row.stops[0].stopId || '')))
}
// 线路是否有方向「采过高德几何但站点仍是集团站」——这些就是补齐模式要重采的对象
function needsStopBackfill(no, dirs) {
  // 高德已明确「未收录」的线不再每轮重试，把有限日配额留给真能补的线路
  if (progress.lines[String(no)] === 'not-found') return false
  return dirs.some((d) => {
    const r = rowOf(no, d)
    return !!(r && r.source === 'amap' && !isAmapStops(r))
  })
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
  // use-lineid 走独立配额池，无视 linename 台账，全部重跑
  if (FORCE || BACKFILL_STOPS || USE_LINEID) return false
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

/**
 * 高德 busstop → 前端站点对象。
 * 架构：站点与走向全用高德数据，集团只提供车辆信号/GPS；因此站点 id/名称/坐标一律取高德，
 * 不带集团的 transferInfos。高德 id 形如 BV10060938，sequence 即站序。
 * @param {Array} busstops 高德 busline.busstops
 * @param {boolean} reversed 该方向需反转：站点同 polyline 一起倒序，保持与站序/几何一致
 */
function busstopsToStops(busstops, reversed) {
  const out = []
  for (const b of busstops || []) {
    if (!b || !b.location) continue
    const [lng, lat] = String(b.location).split(',').map(Number)
    if (!isFinite(lng) || !isFinite(lat) || lng === 0 || lat === 0) continue
    out.push({
      stopNo: b.sequence != null ? Number(b.sequence) : undefined,
      stopId: b.id || '',
      stopName: b.name || '',
      longitude: lng,
      latitude: lat,
    })
  }
  if (!reversed) return out
  // 反转后重排序号：站名顺序才是行进方向，stopNo 应随之 1..N 递增，
  // 否则前端 cleanStops 的 sortByNo 会按旧 sequence 把方向倒回去。
  const rev = out.reverse()
  rev.forEach((s, i) => { s.stopNo = i + 1 })
  return rev
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
  console.error(`  [dbg] inputtips ${lineNo}: ${JSON.stringify(t).slice(0, 200)}`)
  if (isQuotaOut(t)) { FALLBACK_EXHAUSTED = true; return null }
  if (!t || t.status !== '1') return null
  const ids = (t.tips || []).filter((x) => x && x.id && tipMatchesNo(x.name, lineNo)).slice(0, 4)
  console.error(`  [dbg] matched tips: ${ids.length}`)
  // inputtips 是模糊搜索，对集团纯数字号经常只返回「408路 / 轨道交通4号线」这类干扰项，
  // 甚至 0 条。查不到精确 POI 一律返回 null（= 本轮无法判定，不记账），
  // 等 linename 次日额度恢复后用主链路重试；绝不能记成 not-found 把线路永久跳过。
  if (!ids.length) return null
  const out = []
  for (const x of ids) {
    const j = await amapGet('/v3/bus/lineid', { id: String(x.id), city: CITYNAME, extensions: 'all' })
    console.error(`  [dbg] lineid ${x.id}: ${JSON.stringify(j).slice(0, 200)}`)
    if (isQuotaOut(j)) { FALLBACK_EXHAUSTED = true; return null }
    const b = j && Array.isArray(j.buslines) && j.buslines[0]
    if (b && b.polyline) out.push(b)
  }
  return out.length ? out : null
}

async function queryAmap(lineNo) {
  if (USE_LINEID || QUOTA_EXHAUSTED) return queryAmapFallback(lineNo)
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
    // 同分时优先「方向一致」的 busline（reversed=false）：高德常同时给正反两条线，
    // 精确方向那条才该被选中；否则会选到反方向再反转，站点数/顺序都对不上集团方向。
    if (score > bestScore || (score === bestScore && score >= 1 && !reversed && best && best.reversed)) {
      bestScore = score
      best = { bl, reversed }
    }
  }
  if (!best || bestScore < 1 || !best.bl.polyline) return null
  return { polyline: best.bl.polyline, busstops: best.bl.busstops || [], reversed: best.reversed, id: best.bl.id }
}

/** 两点球面近似距离（米），用于几何方向判定 */
function distM(a, b) {
  return Math.hypot((a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 110540)
}
/**
 * 几何方向判定：用「清洗后站点」的首末坐标判断 polyline 是否需要反转。
 * 站名匹配（matchBusline）在「线路改线 / 起讫站改名」时会失效（如 646 阳新路公交停车场
 * 改官堤路公交场站），此时回退到该方法：head 靠近首站且 tail 靠近末站 → 不反转；反之反转。
 * 用精确坐标比站名更可靠（站名可能改、坐标不会凭空对不上）。
 */
function decideReverseByStops(pts, stops) {
  if (!pts.length || !stops || stops.length < 2) return { need: false, ok: false }
  const head = pts[0], tail = pts[pts.length - 1]
  const s0 = { lng: +stops[0].longitude, lat: +stops[0].latitude }
  const s1 = { lng: +stops[stops.length - 1].longitude, lat: +stops[stops.length - 1].latitude }
  const normal = distM(head, s0) + distM(tail, s1)
  const reversed = distM(head, s1) + distM(tail, s0)
  // 两端都离得很远（>3km）说明这条 polyline 与本方向站点根本不是同一条线，判失败
  if (normal > 6000 && reversed > 6000) return { need: false, ok: false }
  return { need: reversed < normal, ok: true }
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
  amapMiss: 0, dirMiss: 0, fallback: 0, valMiss: 0 }

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

// ── --validate-done：复校验已 done 的线，不过就撤销台账让它重拉 ──
// 这是 646 / 361 事故的防御机制：线路改道后资产仍是旧的，但台账标了 done 永久跳过。
// 纯本地校验（不发网络请求、不消耗高德配额），每轮 CI 都能跑。
if (VALIDATE_DONE || VALIDATE_ONLY) {
  let revalidated = 0, unmarked = 0
  const staleList = []
  for (const [no, state] of Object.entries(progress.lines)) {
    // --validate-done 只复校验 done（那些会被跳过的）；--validate-only 扫全部
    if (VALIDATE_DONE && state !== 'done') continue
    revalidated++
    const line = (lib.lines || []).find((x) => String(x.no) === no)
    if (!line) continue
    const dirs = (line.dirs && line.dirs.length ? line.dirs : [0]).map(Number)
    let anyBad = false
    for (const d of dirs) {
      const r = rowOf(no, d)
      if (!r || r.source !== 'amap' || !r.stops || r.stops.length < 2 || !r.route || r.route.length < 2) continue
      const poly = routeToPoly(r.route)
      const v = validateStopsAgainstPolyline(r.stops, poly, { maxDeviation: 200 })
      if (!v.ok) { anyBad = true; staleList.push(`${no} dir${d} 偏离${v.maxDeviation.toFixed(0)}m@${v.worstStop}`) }
    }
    // 只有 --validate-done（采集前自愈）才撤销台账；--validate-only 仅报告不改台账
    if (anyBad && VALIDATE_DONE) { delete progress.lines[no]; unmarked++ }
  }
  if (unmarked && !DRY) saveProgress()
  console.log(`\n复校验 ${revalidated} 条线：${staleList.length} 条几何校验不过${VALIDATE_DONE ? `，已撤销 ${unmarked} 条台账，本轮自动重拉` : '（--validate-only 仅报告，未修改台账）'}`)
  if (staleList.length) {
    console.log(`  异常明细：${staleList.slice(0, 12).join(' | ')}${staleList.length > 12 ? ` ... 等 ${staleList.length} 项` : ''}`)
  }
  if (VALIDATE_ONLY) {
    console.log(`\n--validate-only 模式：仅校验，不采集、不改台账。`)
    process.exit(0)
  }
}

let doneCount = 0
for (const l of todoFinal) {
  if (FALLBACK_EXHAUSTED) break
  if (MAX_LINES && doneCount >= MAX_LINES) {
    console.log(`\n已达本轮上限 --max-lines ${MAX_LINES}，提前结束；台账已落盘，下轮自动续采。`)
    break
  }
  const no = String(l.no)
  const dirs = (l.dirs && l.dirs.length ? l.dirs : [0]).map(Number)

  // 补齐模式：只重采「站点仍是集团站」的线路，两方向都已换成高德站的不浪费配额
  if (BACKFILL_STOPS) {
    if (!needsStopBackfill(no, dirs)) { stats.skipped++; continue }
  // 增量重拉：清单内线路强制重拉（无视台账 / 已 amap），实现「线路更新后获取最新走向」
  } else if (changedLines) {
    // 不跳过，直接走下方高德查询
  } else {
    // 台账命中即跳过：包括「高德未收录」「方向未匹配」这些过去每轮都会重打的线路
    if (isLogged(no)) { stats.skipped++; continue }

    // 双保险：台账被手删时，资产本身已全是 amap 的线也不重打（use-lineid 走独立配额，全部重跑）
    if (!FORCE && !USE_LINEID && dirs.every((d) => { const r = rowOf(no, d); return r && r.source === 'amap' })) {
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
    // 补齐模式：站点已是高德的方向跳过，只补仍是集团站的方向
    if (BACKFILL_STOPS && isAmapStops(prev)) { stats.skipped++; continue }
    // 增量重拉时强制重写（含原已 amap 的方向）；否则遵守「amap 不覆盖」
    // use-lineid 走独立配额池，无视已有 amap 结果，全部重跑
    if (!BACKFILL_STOPS && !changedLines && !FORCE && !USE_LINEID && prev && prev.source === 'amap') { stats.skipped++; continue }

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

    // 用 base 的稳定起讫站匹配高德方向：base.startStop/endStop 来自集团线路基础信息，
    // 不随站点数组被高德覆盖而改变，是该方向真实行进方向的可靠基准。
    // （站点数组经反复重采/反转后首末可能被打乱，不能用它判断方向。）
    const firstStop = (base && base.startStop) || (rawStops[0] && rawStops[0].stopName) || stops[0].stopName
    const lastStop = (base && base.endStop) || (rawStops[rawStops.length - 1] && rawStops[rawStops.length - 1].stopName) || stops[stops.length - 1].stopName
    let m = matchBusline(buslines, firstStop, lastStop)
    if (!m) m = matchBusline(buslines, stops[0].stopName, stops[stops.length - 1].stopName)

    let pts, reversed, amapId, amapName, amapStops = null
    if (m) {
      // 站名匹配成功：沿用高德 busline 的 reversed 标记
      pts = parsePolyline(m.polyline)
      reversed = m.reversed
      amapId = m.id || null
      amapName = (buslines[0] && buslines[0].name) || null
      // 站点以高德为准：busline 自带 busstops，替换掉集团 /line 的站点
      // （集团站含旧站残留/另一套 id，用户架构要求站点只用高德）
      const cand = busstopsToStops(m.busstops, reversed)
      if (cand.length >= 2) amapStops = cand
    } else {
      // 站名匹配失败（常见于线路改线 / 起讫站改名）：用资产已存的稳定 lineid 直查该方向
      // polyline，再按最新站点坐标做几何方向判定。没有 id 才真正放弃。
      const oldId = prev && prev.amap && (prev.amap.id || (prev.amap.newbus && prev.amap.newbus.id))
      if (!oldId) { stats.dirMiss++; stats.fallback++; unresolved++; continue }
      const j = await amapGet('/v3/bus/lineid', { id: String(oldId), city: CITYNAME, extensions: 'all' })
      if (isQuotaOut(j)) { FALLBACK_EXHAUSTED = true; break }
      const bl = j && Array.isArray(j.buslines) && j.buslines[0]
      if (!bl || !bl.polyline) { stats.dirMiss++; stats.fallback++; unresolved++; continue }
      pts = parsePolyline(bl.polyline)
      const dec = decideReverseByStops(pts, stops)
      if (!dec.ok) { stats.dirMiss++; stats.fallback++; unresolved++; continue }
      reversed = dec.need
      amapId = String(oldId)
      amapName = bl.name || null
      const cand = busstopsToStops(bl.busstops, reversed)
      if (cand.length >= 2) amapStops = cand
      stats.fallback++
    }
    if (!pts || pts.length < 2) { stats.dirMiss++; stats.fallback++; unresolved++; continue }
    // 高德 polyline 本就优化过，只做极轻抽稀去掉浮点抖动，不丢走向细节
    // reversed=true 表示该方向的起讫站与高德 busline 相反。必须反转点序，否则上下行几何
    // 同向重合，「全部」视角里后画的玫红会整条盖掉青蓝，方向箭头也反了。
    const route = simplify(pts, 0.00001)
    const dirRoute = reversed ? route.slice().reverse() : route
    if (dirRoute.length < 2) { stats.dirMiss++; stats.fallback++; unresolved++; continue }

    const lats = route.map((p) => p.lat), lngs = route.map((p) => p.lng)
    const bounds = `${Math.min(...lngs).toFixed(6)};${Math.min(...lats).toFixed(6)};${Math.max(...lngs).toFixed(6)};${Math.max(...lats).toFixed(6)}`
    putRow(no, d, {
      base,
      // 站点优先高德；高德没给 busstops 时才保留集团站（避免数据缺失）
      stops: slimStops(amapStops || stops),
      route: toFlat(dirRoute),
      snapped: true,
      source: 'amap',
      algo: AMAP_ALGO,
      // 保留上一行 amap 的既有元数据（如 newbus），只刷新会变的字段，避免丢失来源信息
      amap: { ...((prev && prev.amap) || {}), name: amapName, reversed, id: amapId, ...(prev && prev.amap && prev.amap.newbus ? { newbus: { ...prev.amap.newbus, bounds, length: prev.amap.newbus.length } } : {}) },
      clean: prev && prev.clean,
    })
    stats.matched++
    lineMatched = true
  }

  // 记账：临时故障不记，下一轮重试；否则按结果记入台账，本轮及后续都不再重打。
  // 每条线立即落盘，中途 Ctrl+C / 取消也只丢当前这一条，不会成片重复采集。
  //
  // 采集后几何校验（646/361 防御）：刚拉到的走向也可能与站点不贴合（如上游 polyline
  // 本身异常 / 站点清洗排序错乱），此时不能标 done，否则下轮跳过就再也发现不了。
  // 校验不过 → 标 partial，下一轮 --validate-done 复校验或 --retry-unmatched 会重拉。
  if (!transient) {
    let allValid = unresolved === 0
    if (allValid) {
      for (const d of dirs) {
        const r = rowOf(no, d)
        if (!r || r.source !== 'amap' || !r.stops || r.stops.length < 2 || !r.route || r.route.length < 2) { allValid = false; break }
        const poly = routeToPoly(r.route)
        const v = validateStopsAgainstPolyline(r.stops, poly, { maxDeviation: 200 })
        if (!v.ok) { allValid = false; stats.valMiss++; break }
      }
    }
    mark(no, allValid ? 'done' : (lineMatched ? 'partial' : 'no-match'))
    saveProgress()
  }

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
if (BACKFILL_STOPS) console.log('（--backfill-stops：仅补齐站点仍为集团站的方向，已转好的不动）')
console.log(`\n完成：写入 amap 方向 ${stats.matched} 个（覆盖线路 ${stats.done} 条），跳过 ${stats.skipped}`)
console.log(`高德未收录 ${stats.amapMiss} 条线（保留 OSRM 兜底），方向未匹配 ${stats.dirMiss}，补 /line ${stats.probe}，几何校验未通过 ${stats.valMiss}`)
console.log(`分片 ${files.length} 个，本次写出 ${(writeBytes / 1024).toFixed(1)} KB${DRY ? '（dry 未落盘）' : ''}`)
console.log(`进度台账 ${path.relative(process.cwd(), PROGRESS)}：共 ${Object.keys(progress.lines).length} 条线 ` +
  `(done ${tally.done || 0} / partial ${tally.partial || 0} / no-match ${tally['no-match'] || 0} / not-found ${tally['not-found'] || 0})`)
if (FALLBACK_EXHAUSTED) console.log('主链路与备用链路配额均耗尽，提前停机；未处理的线路未记账，次日 0 点后重跑自动续采。')
else if (QUOTA_EXHAUSTED) console.log('本轮 linename 配额耗尽，已自动切换备用链路 inputtips → lineid 继续采集。')
console.log('提示：未命中 amap 的方向仍由 scan-routes.mjs 的 OSRM 几何兜底，无需手动处理；如需重试未命中线路用 --retry-unmatched。')
process.exit(0)
