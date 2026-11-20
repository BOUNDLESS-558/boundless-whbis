/**
 * 线路 POI id 回填器：为 src/static/lines/ 里 source:'amap' 的方向补 amap.id。
 *
 * 为什么需要它：兼容模式 scan-poi-newbus.mjs 按 id 调 www.amap.com/ssr/api/getPoiNewbus，
 * 但历史资产（1531 个方向）没有存线路 POI id —— 主链路 scan-routes-amap.mjs 早期版本没落这个字段。
 * 现在两条采集器都已补上 amap.id，历史资产只需用本脚本回填一次。
 *
 * id 从哪来：/v3/assistant/inputtips?datatype=busline 按线路名精确匹配，返回的 tips[].id
 * 就是 getPoiNewbus 需要的 id（实测 337 → 900000128833、681 → 900000162531，与浏览器抓包一致）。
 * 该接口与 /v3/bus/linename 日配额池独立：linename 报 10044 时它仍可用（见 scan-routes-amap.mjs
 * 的备用链路）。实测对 451 条 amap 线路抽样 30 条，命中率 100%，通常每线返回 2 个 id（双向）。
 * id 有两种格式（900000... / 420100...），实测都能喂给 getPoiNewbus。
 *
 * 双向定向：inputtips 的 tip 只有 id + name，没有起讫站。用 getPoiNewbus 返回的
 * front_name / terminal_name 与资产 base.startStop / endStop 比对来区分上下行；
 * 响应里的 direc 字段就是对向 id，可省一次请求。
 * 用 --no-verify 可跳过定向（不调网页接口、不需 Cookie），直接把候选 id 按 dirs 顺序分配。
 *
 * 用法：
 *   $env:AMAP_KEY="你的高德Web服务Key"
 *   $env:AMAP_WEB_COOKIE="..."        # 仅默认（需定向）模式必填
 *   $env:NODE_USE_ENV_PROXY="1"       # 本机需代理时
 *   node scripts/scan-amap-ids.mjs --only 337,681,243 --dry   # 小样本先验证
 *   node scripts/scan-amap-ids.mjs                             # 全量回填
 *   node scripts/scan-amap-ids.mjs --no-verify                 # 不调网页接口，只按序号分配
 *
 * 只补强不降级：已有 amap.id 的方向默认跳过（--force 才重写），绝不改 route / stops / source。
 * 断点续跑：每处理完一条线立即落盘；--only / --limit 可分批。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── 参数 ──
const argv = process.argv.slice(2)
function arg(name, dflt) {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}
const has = (n) => argv.includes('--' + n)
const ONLY = String(arg('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const DELAY = Math.max(0, Number(arg('delay', 250)))
const MAX = Math.max(0, Number(arg('limit', 0)))
const DRY = has('dry')
const FORCE = has('force')
const NO_VERIFY = has('no-verify')
const OUT = path.resolve(ROOT, arg('out', 'src/static/lines'))

const KEY = process.env.AMAP_KEY || ''
if (!KEY) {
  console.error('缺少 AMAP_KEY：inputtips 是高德 Web 服务接口，需要 Key（与 linename 配额池独立）。')
  console.error('  PowerShell:  $env:AMAP_KEY="你的Key"')
  process.exit(2)
}
const CK = process.env.AMAP_WEB_COOKIE || ''
if (!NO_VERIFY && !CK) {
  console.error('默认模式需要 AMAP_WEB_COOKIE 做双向定向（getPoiNewbus 需会话 Cookie）。')
  console.error('若只需按 dirs 顺序粗分配，加 --no-verify 即可不调网页接口、不需 Cookie。')
  process.exit(2)
}
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) {
  process.env.NODE_USE_ENV_PROXY = '1'
}
const CITYNAME = '武汉'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const CSRF = decodeURIComponent((CK.match(/x-csrf-token=([^;]+)/) || [])[1] || '')
const DIU = (CK.match(/(?:^|;\s*)diu=([^;]+)/) || [])[1] || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => String(s || '').replace(/\s|[（(].*?[)）]|站$/g, '')

// ── 分片读写 ──
const SHARDS = new Map()
const dirty = new Set()
// 分片按公司分子目录（jt/cc/ml/hq），递归收集所有分片
function shardPath(k, sub) { return path.join(OUT, sub, k + '.json') }
function listShardKeys() {
  const out = []
  for (const sub of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    const p = path.join(OUT, sub)
    if (!fs.statSync(p).isDirectory()) continue
    for (const f of fs.readdirSync(p)) {
      if (/^(?:b\d+|CCB\d+|MLB\d+|HQB\d+)\.json$/.test(f)) out.push({ key: f.replace(/\.json$/, ''), sub })
    }
  }
  return out
}
function loadShard(k, sub) {
  const ck = sub + '/' + k
  if (SHARDS.has(ck)) return SHARDS.get(ck)
  let data = { updated: '', version: 0, lines: {} }
  try {
    const j = JSON.parse(fs.readFileSync(shardPath(k, sub), 'utf8'))
    if (j && j.lines && typeof j.lines === 'object') data = j
  } catch (e) { /* 新分片 */ }
  SHARDS.set(ck, data)
  return data
}
const seenShards = new Set()
function saveDirty() {
  const keys = [...dirty]
  dirty.clear()
  for (const ck of keys) {
    const s = SHARDS.get(ck)
    if (!s) continue
    const i = ck.lastIndexOf('/')
    const k = ck.slice(i + 1), sub = ck.slice(0, i)
    s.updated = new Date().toISOString()
    if (!DRY) fs.writeFileSync(shardPath(k, sub), JSON.stringify(s) + '\n', 'utf8')
    seenShards.add(ck)
  }
}

// ── inputtips：按线路名精确匹配拿候选 id ──
// 线路号 != 高德线路名（蔡甸214路 / Z220路 / 530路外环 / 汉奇22号线 / P41路），
// 所以除「线路号+路」外，还要用资产里存的高德全名 / 上游 lineName 的括号前部分兜底。
function keywordsOf(no, rows) {
  const out = /(路|线)$/.test(no) ? [no] : [no + '路', no]
  for (const { row } of rows) {
    const cands = [row.amap && row.amap.name, row.base && row.base.lineName]
    for (const c of cands) {
      if (!c) continue
      const name = String(c).split(/[(（]/)[0].trim()
      if (name && name.length >= 2 && !out.includes(name)) out.push(name)
    }
  }
  return out
}
async function queryIds(no, rows) {
  let transient = false
  for (const kw of keywordsOf(no, rows)) {
    const p = { keywords: kw, city: CITYNAME, citylimit: 'true', datatype: 'busline', key: KEY, output: 'json' }
    const qs = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    // 高频批量时偶发 fetch 瞬断：重试 2 次，否则会把「网络抖动」误记成「高德未收录」
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://restapi.amap.com/v3/assistant/inputtips?${qs}`, { signal: AbortSignal.timeout(15000) })
        const j = await r.json()
        if (j.infocode === '10044') { QUOTA_OUT = true; return null }
        if (j.infocode === '10003' || j.infocode === '10004') { await sleep(600 * (attempt + 1)); continue }
        if (j.status !== '1' || !Array.isArray(j.tips)) break
        const exact = j.tips.filter((t) => t && t.id && norm(t.name) === norm(kw)).map((t) => String(t.id))
        if (exact.length) return exact
        break   // 该关键词确实无精确匹配，换下一个
      } catch (e) {
        transient = true
        await sleep(400 * (attempt + 1))
      }
    }
  }
  // 所有关键词都因网络失败 → 本轮无法判定，别记成「未收录」，下轮重试
  return transient ? null : []
}
let QUOTA_OUT = false

// ── getPoiNewbus：拿起讫站给 id 定向（同时可复用 direc 补对向）──
async function peek(id, no, rows) {
  const kw = keywordsOf(no, rows)[0]
  const q = encodeURIComponent(kw)
  const url = `https://www.amap.com/ssr/api/getPoiNewbus?id=${encodeURIComponent(id)}&keywords=${q}&city=420100`
  const ref = `https://www.amap.com/ssr/search/busline_detail?query_type=TQUERY&query=${q}&city=420100&busId=${encodeURIComponent(id)}&keywords=${q}&key_name=${q}`
  const h = {
    'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Referer': ref,
    'Cookie': CK, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
  }
  if (CSRF) h['x-csrf-token'] = CSRF
  if (DIU) h['x-adiu'] = DIU
  try {
    const r = await fetch(url, { headers: h, redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (r.status !== 200) { SESSION_BAD = true; return null }
    const j = await r.json()
    const b = j && j.data && j.data.busline_list && j.data.busline_list[0]
    if (!b) return null
    return { id: String(b.id), front: b.front_name, terminal: b.terminal_name, direc: b.direc ? String(b.direc) : null }
  } catch (e) { return null }
}
let SESSION_BAD = false

// 起讫站与该方向资产 base 的吻合度：2=正序，1=反序（资产方向编码可能与高德相反），0=不吻合
function dirScore(info, base) {
  const s = norm(base && base.startStop), e = norm(base && base.endStop)
  const f = norm(info.front), t = norm(info.terminal)
  if (!s || !e || !f || !t) return 0
  const eq = (a, b) => a.includes(b) || b.includes(a)
  if (eq(f, s) && eq(t, e)) return 2
  if (eq(f, e) && eq(t, s)) return 1
  return 0
}
// 双向互斥分配：每个方向各拿一个不同的 id，按吻合度降序贪心，未分配的退回候选顺序
function assignIds(rows, infos, ids) {
  const pairs = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < infos.length; j++) {
      const sc = dirScore(infos[j], rows[i].row.base)
      if (sc > 0) pairs.push({ i, j, sc })
    }
  }
  pairs.sort((a, b) => b.sc - a.sc)
  const out = new Array(rows.length).fill(null)
  const used = new Set()
  for (const p of pairs) {
    if (out[p.i] || used.has(p.j)) continue
    out[p.i] = infos[p.j].id
    used.add(p.j)
  }
  return out.map((v, i) => v || ids[i] || ids[0])
}

// ── 主流程 ──
const keys = listShardKeys()
const targets = new Map() // no → [{ key, sub, dir, row }]
for (const { key, sub } of keys) {
  const shard = loadShard(key, sub)
  for (const [no, line] of Object.entries(shard.lines || {})) {
    for (const [dir, row] of Object.entries(line.dirs || {})) {
      if (!row || row.source !== 'amap') continue  // OSRM 兜底行不需要 id
      if (!FORCE && row.amap && row.amap.id) continue
      if (ONLY.length && !ONLY.includes(String(no))) continue
      if (!targets.has(no)) targets.set(no, [])
      targets.get(no).push({ key, sub, dir, row })
    }
  }
}
const todos = [...targets.entries()]
if (MAX) todos.length = Math.min(todos.length, MAX)
console.log(`amap.id 回填：${todos.length} 条线待处理（${todos.reduce((n, e) => n + e[1].length, 0)} 个方向）` +
  `${NO_VERIFY ? '（--no-verify 粗分配）' : '（getPoiNewbus 定向）'}${DRY ? '（dry，不落盘）' : ''}`)
if (!todos.length) { console.log('全部已回填，无需处理。'); process.exit(0) }

const stats = { done: 0, hit: 0, miss: 0, verified: 0, assigned: 0, transient: 0 }
for (const [no, rows] of todos) {
  if (QUOTA_OUT || SESSION_BAD) break
  const ids = await queryIds(no, rows)
  if (ids === null) {
    if (QUOTA_OUT) break
    stats.transient++   // 网络瞬断：不记账、不落盘，下轮自动重试
    continue
  }
  if (!ids.length) { stats.miss++; stats.done++; continue }
  stats.hit++

  let infos = []
  if (!NO_VERIFY) {
    // 每个候选 id 调一次 getPoiNewbus 拿起讫站；响应里的 direc 就是对向 id，
    // 直接构造「起讫站互换」的对向 info，省掉第二次请求。
    const seen = new Set()
    for (const id of ids.slice(0, 4)) {
      if (seen.has(id)) continue
      const info = await peek(id, no, rows)
      if (SESSION_BAD) break
      if (info) {
        infos.push({ id: info.id, front: info.front, terminal: info.terminal })
        seen.add(info.id)
        if (info.direc && !seen.has(info.direc)) {
          infos.push({ id: info.direc, front: info.terminal, terminal: info.front })
          seen.add(info.direc)
        }
      }
      await sleep(DELAY)
    }
    stats.verified += infos.length
  }

  const assigned = assignIds(rows, infos, ids)
  for (let i = 0; i < rows.length; i++) {
    const { key, sub, row } = rows[i]
    row.amap = row.amap || {}
    row.amap.id = assigned[i]
    stats.assigned++
    dirty.add(sub + '/' + key)
  }
  stats.done++
  if (stats.done % 25 === 0 || stats.done === todos.length) {
    const msg = `  已处理 ${stats.done}/${todos.length}（命中线路 ${stats.hit}，回填方向 ${stats.assigned}）`
    if (process.env.GITHUB_ACTIONS) console.log(msg)
    else process.stdout.write(`\r${msg}`)
    saveDirty()
  }
  await sleep(DELAY)
}
saveDirty()
if (!process.env.GITHUB_ACTIONS) process.stdout.write('\n')
console.log(`完成：命中线路 ${stats.hit}，未收录 ${stats.miss}，网络瞬断 ${stats.transient}，回填 ${stats.assigned} 个方向，写出分片 ${seenShards.size} 个` +
  `${DRY ? '（dry）' : ''}`)
if (stats.transient) console.log('存在网络瞬断的线路：未记账，重跑本命令即可自动续采。')
if (QUOTA_OUT) console.log('inputtips 配额耗尽，已停止；已回填部分已落盘，次日 0 点后重跑自动续采。')
if (SESSION_BAD) console.log('AMAP_WEB_COOKIE 失效（302），重新抓取后重跑；或加 --no-verify 跳过定向。')
process.exit(QUOTA_OUT || SESSION_BAD ? 1 : 0)
