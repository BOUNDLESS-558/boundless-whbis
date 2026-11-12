/**
 * 线路资产采集器（C）：高德网页端线路详情，补全剩余线路的站点 + 走向。
 *
 * 为什么需要第三条链路：
 *   主链路 /v3/bus/linename 对 D/K 定制线返回 10021（查无结果），
 *   备用链路 inputtips 能拿到这些线路的 POI id，但其 lineid 接口对部分 id 不兼容；
 *   网页端 /ssr/api/getPoiNewbus?id=<POI id> 能稳定返回完整 stations + xs/ys。
 *
 * 链路：
 *   线路号 → /v3/assistant/inputtips?datatype=busline（拿 POI id，走 AMAP_KEY 独立配额池）
 *          → www.amap.com/ssr/api/getPoiNewbus?id=...（拿站点 + 走向，不消耗 Web 服务 Key 配额）
 *          → 字段映射 → src/static/lines/bNN.json
 *
 * 站点口径（B 方案）：高德站点写进 stops，stopId = md5(station_id).toUpperCase()。
 *   stopId 在本项目只作前端 :key 与去重键，无业务语义；集团资产原本就是混合格式。
 *   xy_coords 拆经纬度，station_num 作 stopNo，name 作 stopName。
 *
 * ⚠ 网页端接口是内部接口，需要 amap_migrated_to_new_version=1 这个非登录态 Cookie。
 *   不需要 passport_login / x-csrf-token / bx-ua 等任何登录态或风控签名。
 *
 * ⚠ inputtips 是模糊搜索，会混入 401路 / J211路 之类干扰项，
 *   必须按 key_name 严格匹配线路号，否则会把别的线路几何写进资产。
 *
 * 用法：
 *   node scripts/scan-amap-web.mjs --dry --only 337             # 小样本验证，不落盘
 *   node scripts/scan-amap-web.mjs --only D102,D553,K4          # 指定线路
 *   node scripts/scan-amap-web.mjs --limit 50                   # 限量跑
 *   node scripts/scan-amap-web.mjs                              # 全量断点续跑
 *   node scripts/scan-amap-web.mjs --retry-unmatched            # 重试本台账未完成的
 *
 * 台账 scripts/.amap-web-progress.json 独立于 CI 的 .amap-progress.json，
 * 避免本地补全与 amap-data 定时采集互相覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import RC from './_loadRouteClean.mjs'

const { simplify, toFlat, shardOf, haversine } = RC

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
const PROGRESS = path.resolve(argOf('progress', 'scripts/.amap-web-progress.json'))
const ONLY = String(argOf('only', '')).split(',').map(s => s.trim()).filter(Boolean)
const LIMIT = Math.max(0, Number(argOf('limit', 0)))
const DELAY = Math.max(0, Number(argOf('delay', 500)))
const DRY = has('dry')
const RETRY_UNMATCHED = has('retry-unmatched')
// 只重算本脚本自己写的行（amap.web===true），用于修复早期版本写错的数据；
// 绝不触碰主链路 /v3/bus/linename 采集的 amap 行
const REDO_WEB = has('redo-web')
const VERBOSE = has('verbose')
const DUMP = has('dump')
const CI_LOG = has('ci-log') || !!process.env.GITHUB_ACTIONS
const CITY_NAME = argOf('city', '武汉')
const CITY_CODE = argOf('city-code', '420100')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const KEY = process.env.AMAP_KEY
if (!KEY) {
  console.error('缺少 AMAP_KEY：inputtips 链路需要高德 Web 服务 Key（仅用于查 POI id）。')
  process.exit(2)
}

// ── 分片读写（与 scan-routes-amap.mjs 同结构）──
const SHARDS = new Map()
const dirty = new Set()
const shardPath = k => path.join(OUT, k + '.json')
function loadShard(key) {
  if (SHARDS.has(key)) return SHARDS.get(key)
  let data = { updated: '', version: 0, lines: {} }
  try {
    const j = JSON.parse(fs.readFileSync(shardPath(key), 'utf8'))
    if (j && j.lines && typeof j.lines === 'object') data = j
  } catch (e) { /* 不存在/损坏：空分片 */ }
  SHARDS.set(key, data)
  return data
}
function rowOf(no, dir) {
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

// ── 台账 ──
const progress = { updated: '', version: 1, lines: {} }
let progressSnapshot = ''
function loadProgress() {
  try {
    const j = JSON.parse(fs.readFileSync(PROGRESS, 'utf8').replace(/^\uFEFF/, ''))
    if (j && j.lines && typeof j.lines === 'object') Object.assign(progress.lines, j.lines)
  } catch (e) { /* 首次运行 */ }
  progressSnapshot = JSON.stringify(progress.lines)
}
function saveProgress() {
  if (DRY) return
  const snap = JSON.stringify(progress.lines)
  if (snap === progressSnapshot) return
  progressSnapshot = snap
  progress.updated = new Date().toISOString()
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true })
  fs.writeFileSync(PROGRESS, JSON.stringify(progress) + '\n', 'utf8')
}
const mark = (no, state) => { progress.lines[String(no)] = state }
function isLogged(no) {
  if (REDO_WEB) return false   // 强制重算，配合 --only 限定范围
  const s = progress.lines[String(no)]
  if (!s) return false
  return !(RETRY_UNMATCHED && s !== 'done')
}

// ── HTTP ──
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const WEB_COOKIE = 'amap_migrated_to_new_version=1'
let QUOTA_OUT = false

async function amapGet(pathname, params) {
  const p = new URLSearchParams({ key: KEY, output: 'json', ...params })
  try {
    const r = await fetch('https://restapi.amap.com' + pathname + '?' + p, { signal: AbortSignal.timeout(15000) })
    return await r.json()
  } catch (e) { return null }
}
async function webDetail(id) {
  const u = 'https://www.amap.com/ssr/api/getPoiNewbus?id=' + encodeURIComponent(id) + '&city=' + CITY_CODE
  try {
    const r = await fetch(u, {
      headers: {
        'user-agent': UA,
        'accept': 'application/json, text/plain, */*',
        'cookie': WEB_COOKIE,
        'referer': 'https://www.amap.com/ssr/search/busline_detail',
      },
      signal: AbortSignal.timeout(15000),
    })
    const t = await r.text()
    if (!t.trimStart().startsWith('{')) return null   // 被网关挡回 HTML
    const j = JSON.parse(t)
    return (j.data && Array.isArray(j.data.busline_list) && j.data.busline_list[0]) || null
  } catch (e) { return null }
}

/** 名称是否就是该线路号（防 inputtips 把 K4 匹配到 401路、211 匹配到 J211路） */
function nameMatchesNo(name, no) {
  const s = String(name || '').trim()
  const n = String(no)
  if (s === n) return true
  if (!s.startsWith(n)) return false
  return /^(路|线|\(|（|\s|$)/.test(s.slice(n.length))
}

// ── 字段映射（B 方案）──
function toStops(stations) {
  return (stations || []).map((s, i) => {
    const [lng, lat] = String(s.xy_coords || '').split(';').map(Number)
    const seed = s.station_id || s.poiid1 || (String(s.name) + ':' + i)
    return {
      stopNo: Number(s.station_num) || i + 1,
      // md5 返回小写，现有集团资产是大写 32 位 hex；统一大写
      stopId: crypto.createHash('md5').update(String(seed)).digest('hex').toUpperCase(),
      stopName: String(s.name || '').trim(),
      longitude: +lng,
      latitude: +lat,
    }
  }).filter(s => Number.isFinite(s.longitude) && Number.isFinite(s.latitude) && s.stopName)
}
function toPts(b) {
  const xs = String(b.xs || '').split(',').filter(Boolean).map(Number)
  const ys = String(b.ys || '').split(',').filter(Boolean).map(Number)
  const n = Math.min(xs.length, ys.length)
  const pts = []
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push({ lng: xs[i], lat: ys[i] })
  }
  return pts
}

/** 方向判定：用起讫站名与高德 front/terminal 比对；往返线路常只给一条 polyline */
function dirsMatch(b, l) {
  const f = String(b.front_name || '').trim()
  const t = String(b.terminal_name || '').trim()
  const a = String(l.start || '').trim()
  const z = String(l.end || '').trim()
  const norm = s => s.replace(/站$/, '').replace(/公交站/g, '公交')
  const same = (x, y) => !!x && !!y && (norm(x) === norm(y) || norm(x).includes(norm(y)) || norm(y).includes(norm(x)))
  const forward = same(f, a) && same(t, z)
  const reverse = same(f, z) && same(t, a)
  return { forward, reverse }
}

// ── 主流程 ──
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const allLines = (lib.lines || []).filter(l => l.status !== '停运' && l.stops)
const pool = ONLY.length ? allLines.filter(l => ONLY.includes(String(l.no))) : allLines
if (!DRY) fs.mkdirSync(OUT, { recursive: true })

loadProgress()
const stats = { total: pool.length, done: 0, skipped: 0, matched: 0, noId: 0, noDetail: 0, nameReject: 0, quotaOut: 0 }
console.log(`网页端采集：候选 ${pool.length} 条线，${DRY ? '（dry，不落盘）' : '落盘 ' + path.relative(process.cwd(), OUT)}`)
console.log(`台账 ${path.relative(process.cwd(), PROGRESS)}：已记录 ${Object.keys(progress.lines).length} 条`)

let processed = 0
for (const l of pool) {
  if (QUOTA_OUT) break
  if (LIMIT && processed >= LIMIT) break
  const no = String(l.no)
  if (isLogged(no)) { stats.skipped++; continue }

  // 只补「还不是 amap」的方向。已有 amap 数据可能来自主链路（质量已验证），
  // 绝不覆盖；若整条线都已完成，直接记账跳过，不发任何请求。
  const dirs = (l.dirs && l.dirs.length ? l.dirs : [0]).map(Number)
  const pending = dirs.filter(d => {
    const r = rowOf(no, d)
    if (!r || r.source !== 'amap') return true
    return REDO_WEB && !!(r.amap && r.amap.web)
  })
  if (!pending.length) { mark(no, 'done'); saveProgress(); stats.skipped++; continue }

  processed++
  const tips = await amapGet('/v3/assistant/inputtips', {
    keywords: no, city: CITY_NAME, citylimit: 'true', datatype: 'busline',
  })
  if (tips && (tips.infocode === '10044' || /DAILY_QUERY_OVER_LIMIT/i.test(tips.info || ''))) {
    QUOTA_OUT = true
    console.log('\n[inputtips] 日配额耗尽，提前停机；台账已保存，次日续跑。')
    break
  }
  if (!tips || tips.status !== '1') { stats.noId++; mark(no, 'no-id'); saveProgress(); continue }

  // 严格名称匹配，最多取 4 个候选方向
  const ids = (tips.tips || []).filter(x => x && x.id && nameMatchesNo(x.name, no)).slice(0, 4)
  if (!ids.length) { stats.nameReject++; mark(no, 'no-id'); saveProgress(); continue }

  const details = []
  for (const tip of ids) {
    const b = await webDetail(tip.id)
    if (b && b.xs && b.stations && b.stations.length >= 2 && nameMatchesNo(b.key_name || b.name, no)) {
      details.push(b)
    }
    if (DELAY) await sleep(DELAY)
  }
  if (!details.length) { stats.noDetail++; mark(no, 'no-detail'); saveProgress(); continue }

  // 方向分配：先构造 slot[0]/slot[1]，避免两个方向拿到同一条几何。
  // 环线 / 只有一条详情时，slot[1] 用同一份数据但整体反转（几何 + 站点一起），
  // 否则 dir 0 与 dir 1 正向重合，「全部」视角里后画的会盖掉先画的，方向箭头也反了。
  const seen = new Set()
  const uniq = details.filter(b => { const k = b.id || (b.front_name + b.terminal_name); if (seen.has(k)) return false; seen.add(k); return true })
  const forward = uniq.find(b => dirsMatch(b, l).forward) || uniq[0]
  const backward = uniq.find(b => b !== forward && dirsMatch(b, l).reverse) ||
    uniq.find(b => b !== forward) || null
  const slots = [
    { b: forward, reversed: false },
    backward ? { b: backward, reversed: false } : { b: forward, reversed: true },
  ]

  let wrote = 0
  let unresolved = 0
  for (const d of pending) {
    const prev = rowOf(no, d)
    let pick = slots[d] || null
    if (!pick) {
      // 起讫站对不上时，用已有资产站名做兜底匹配
      const ref = prev && prev.stops && prev.stops[0] && prev.stops[0].stopName
      const cand = uniq.find(b => String(b.front_name || '').trim() === String(ref || '').trim())
      if (cand) pick = { b: cand, reversed: false }
    }
    if (!pick) { unresolved++; continue }

    // 反向兜底：几何与站点序列必须一起反转并重排站序，否则顺序与走向不一致
    const stations = pick.reversed ? [...pick.b.stations].reverse() : pick.b.stations
    const stops = toStops(stations).map((s, i) => ({ ...s, stopNo: i + 1 }))
    const pts = toPts(pick.b)
    if (pick.reversed) pts.reverse()
    const route = simplify(pts, 0.00001)
    if (stops.length < 2 || route.length < 2) { unresolved++; continue }

    const row = {
      base: (prev && prev.base) || {
        direction: '', lineId: '', lineName: String(l.name || no),
        startStop: pick.reversed ? pick.b.terminal_name : pick.b.front_name,
        endStop: pick.reversed ? pick.b.front_name : pick.b.terminal_name,
        price: pick.b.basic_price || '', earlyHour: pick.b.start_time || '', lastHour: pick.b.end_time || '',
      },
      stops,
      route: toFlat(route),
      snapped: true,
      source: 'amap',
      algo: 100,
      amap: { name: pick.b.name || pick.b.key_name || null, reversed: !!pick.reversed, web: true },
      clean: prev && prev.clean,
    }
    putRow(no, d, row)
    if (DUMP && wrote === 0) {
      console.log('\n--- DUMP ' + no + '/' + d + ' ---')
      console.log('  stops[0] = ' + JSON.stringify(row.stops[0]))
      console.log('  stops[last] = ' + JSON.stringify(row.stops.at(-1)))
      console.log('  stops=' + row.stops.length + ' routeFloats=' + row.route.length + ' first6=' + JSON.stringify(row.route.slice(0, 6)))
      console.log('  base = ' + JSON.stringify(row.base))
      console.log('  amap = ' + JSON.stringify(row.amap))
    }
    wrote++
    stats.matched++
  }

  if (VERBOSE || DUMP) {
    console.log('  ' + no + ' -> 写入 ' + wrote + '/' + pending.length + ' 方向' +
      (wrote < pending.length ? ' | 候选详情 ' + details.map(b => b.front_name + '→' + b.terminal_name).join(' ; ') +
        ' | 本地 ' + (l.start || '?') + '→' + (l.end || '?') : ''))
  }
  // 只有把该线原本所有缺失方向都补齐才算 done，否则下次仍会重试
  mark(no, wrote === pending.length ? 'done' : (wrote > 0 ? 'partial' : 'no-match'))
  saveProgress()
  flushDirty()
  if (wrote) stats.done++
  const msg = `  已处理 ${processed}/${pool.length}（写入方向 ${stats.matched}，跳过 ${stats.skipped}）`
  if (CI_LOG) console.log(msg)
  else process.stdout.write('\r' + msg)
  if (DELAY) await sleep(DELAY)
}
flushDirty()
saveProgress()
if (!CI_LOG) process.stdout.write('\n')

const tally = {}
for (const s of Object.values(progress.lines)) tally[s] = (tally[s] || 0) + 1
console.log(`\n完成：写入 amap 方向 ${stats.matched} 个（覆盖线路 ${stats.done} 条），跳过 ${stats.skipped}`)
console.log(`无 id ${stats.noId} / 名称不符 ${stats.nameReject} / 无详情 ${stats.noDetail} / 配额耗尽 ${stats.quotaOut}`)
console.log(`分片 ${dirty.size ? [...dirty].length : [...SHARDS.keys()].length} 个，写出 ${(writeBytes / 1024).toFixed(1)} KB${DRY ? '（dry 未落盘）' : ''}`)
console.log(`台账：共 ${Object.keys(progress.lines).length} 条 ` +
  `(done ${tally.done || 0} / partial ${tally.partial || 0} / no-match ${tally['no-match'] || 0} / no-id ${tally['no-id'] || 0} / no-detail ${tally['no-detail'] || 0})`)
if (QUOTA_OUT) console.log('本轮因 inputtips 配额耗尽提前结束。')
process.exit(0)
