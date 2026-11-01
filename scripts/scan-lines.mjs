/**
 * 线网扫描：枚举武汉公交线路号 → 生成 src/data/lines.json
 *
 * 背景：后端只有「按 lineCode 查单条线路」的 /line，没有线路列表接口。
 * 因此把线路号当枚举空间逐个探测：只要 lineDetailBaseDto.lineName 有值，即判定该线路真实存在
 * （⚠ 站点列表为空不算不存在，见 probe() 里的注释）。
 * 无人值守、可分批、可断点续扫（--merge 累加），结果落盘为前端可直接读取的 JSON。
 *
 * ⚠ 前缀只有 4 种：电 / BRT / K / D。其余字母（J、P、T、V、G、H、Z…）不是本集团线路，
 *   即使接口能返回数据也一律剔除；--prefix 传了白名单外的值会直接报错退出，别再扫字母表。
 *
 * 用法：
 *   node scripts/scan-lines.mjs                     # 默认扫 1~999（含反向复核）
 *   node scripts/scan-lines.mjs --from 1 --to 60    # 小样本试跑
 *   node scripts/scan-lines.mjs --prefix 电,BRT,K,D  # 追加带前缀的线路号（对 1~to 每个前缀各试一遍）
 *   node scripts/scan-lines.mjs --merge             # 与现有 JSON 合并（分批扫描累加）
 *   node scripts/scan-lines.mjs --no-dir1           # 跳过反向复核（请求量减半，dirs 只记 [0]）
 *   node scripts/scan-lines.mjs --out other.json    # 改输出路径
 *   node scripts/scan-lines.mjs --net               # 只生全市线网底图 src/static/network.json（站点坐标串）
 *
 * --net 单独一条道：它读已生成的 lines.json 拿“哪些线在营运”，再逐方向把站点经纬度拉回来，
 * 产物是地图全市视图的线网底图（静态资产，走 HTTP 缓存，不占运行时 API 配额）。
 *
 * 注意：这是**数据生成器**，不是回归探针 —— 项目里唯一允许主动写文件的 script，
 * 因为它的产物（线路库 JSON）本身就是用户要求交付的数据资产。
 */
import fs from 'node:fs'
import path from 'node:path'

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

// ---- 参数 ----
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}
const has = (name) => argv.includes('--' + name)
const FROM = Number(argOf('from', 1))
const TO = Number(argOf('to', 999))
const CONCURRENCY = Math.max(1, Number(argOf('concurrency', 4)))
const DELAY = Math.max(0, Number(argOf('delay', 120)))
const PREFIXES = String(argOf('prefix', '')).split(',').map((s) => s.trim()).filter(Boolean)
// 线路号形态白名单（用户确认）：只有 纯数字 / 电 / BRT / K / D 是本集团营运线路。
// 其余字母前缀（J、P、T、V、G、H、Z…）即使接口能返回数据也不是本集团线路，扫了纯属浪费请求。
const PREFIX_OK = ['电', 'BRT', 'K', 'D']
const BAD_PREFIX = PREFIXES.filter((p) => !PREFIX_OK.includes(p))
if (BAD_PREFIX.length) {
  console.error(`前缀 ${BAD_PREFIX.join(', ')} 不是本集团线路，已拒绝执行。可用前缀只有：${PREFIX_OK.join(' / ')}`)
  process.exit(1)
}
const VERIFY_DIR1 = !has('no-dir1')
const MERGE = has('merge')
// 只对现有 JSON 重跑第 6 步（编号规整 / 白名单 / 去重），不联网；改完后处理逻辑时用它
const NORMALIZE_ONLY = has('normalize-only')
// 全市线网底图模式（产物是 src/static/network.json，与线路库互不干扰）
const NET = has('net')
const OUT = path.resolve(argOf('out', NET ? 'src/static/network.json' : 'src/data/lines.json'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 探测一条线路的某个方向；返回 { ok, dto, stops } 或 { ok:false, reason }；withPts 时附带站点坐标串 */
async function probe(code, dir, withPts) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + '/line', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ ...COMMON, lineCode: `${CITY}-${code}-${dir}` }),
        signal: AbortSignal.timeout(15000),
      })
      const payload = await res.json()
      if (payload && payload.success === true && payload.msg && payload.msg.code === '20000') {
        const dto = (payload.data && payload.data.lineDetailBaseDto) || null
        const stops = (payload.data && payload.data.stopDetailList) || []
        // ⚠ 不能把“站点为空”当成不存在：实测 2/3/5/11/19 路都是 20000 + 有 lineName、但 stopDetailList 为空
        // （服务端站点数据缺失）。只要 lineName 回来就是真实线路，站数记 0 由另一个方向补。
        if (!dto || !dto.lineName) return { ok: false, reason: 'empty' }
        const r = { ok: true, dto, stops: stops.length }
        if (withPts) {
          const pts = []
          for (const s of stops) {
            const la = parseFloat(s.latitude)
            const ln = parseFloat(s.longitude)
            // 缺坐标的站后端回的是 0.0/0.0：不挡的话 bbox 会拉到几内亚湾，走向还会穿到海里去
            if (isNaN(la) || isNaN(ln) || la < 24 || la > 54 || ln < 73 || ln > 135) continue
            pts.push(+ln.toFixed(5), +la.toFixed(5))
          }
          r.pts = pts
        }
        return r
      }
      const msg = (payload && payload.msg && payload.msg.message) || ''
      // 线路不存在是确定性结果，不重试
      if (/线路找不到|不存在/.test(msg) || (payload && payload.msg && payload.msg.code === '3014')) {
        return { ok: false, reason: 'notfound' }
      }
      if (attempt === 2) return { ok: false, reason: 'biz:' + msg }
    } catch (e) {
      if (attempt === 2) return { ok: false, reason: 'net:' + (e && e.message ? e.message : e) }
    }
    await sleep(600 * (attempt + 1))
  }
  return { ok: false, reason: 'retry-exhausted' }
}

/** 简易并发池：保持顺序收集结果，单条失败不中断整体 */
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

// —— --net：全市线网底图（读线路库→逐方向拉站点坐标→落 src/static/network.json）——
if (NET) {
  const LIB = path.resolve(argOf('lib', 'src/data/lines.json'))
  if (!fs.existsSync(LIB)) { console.error('找不到线路库：' + LIB + '（先跑一次普通的 scan-lines）'); process.exit(1) }
  const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
  // 只扫营运线：停运线没有在运车辆，画在地图上纯属干扰
  const todo = []
  for (const l of lib.lines || []) {
    if (l.status === '停运' || !l.stops) continue
    for (const d of (l.dirs && l.dirs.length ? l.dirs : [0])) todo.push({ no: l.no, code: l.code || l.no, dir: d })
  }
  const netSort = (a, b) => {
    const na = Number(a.no)
    const nb = Number(b.no)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    if (!isNaN(na)) return -1
    if (!isNaN(nb)) return 1
    return String(a.no).localeCompare(String(b.no), 'zh-Hans-CN')
  }
  console.log(`线网：${new Set(todo.map((t) => t.no)).size} 条线路 / ${todo.length} 个方向，并发 ${CONCURRENCY}，间隔 ${DELAY}ms`)
  let nd = 0
  const netRes = await pool(todo, async (t) => {
    const r = await probe(t.code, t.dir, true)
    nd++
    if (nd % 25 === 0 || nd === todo.length) process.stdout.write(`\r  线网 ${fmt(nd)}/${fmt(todo.length)}`)
    return { no: t.no, code: t.code, dir: t.dir, r }
  }, CONCURRENCY)
  process.stdout.write('\n')
  const netByNo = new Map()
  let skipped = 0
  for (const it of netRes) {
    if (!it.r || !it.r.ok || !it.r.pts || it.r.pts.length < 4) { skipped++; continue }
    if (!netByNo.has(it.no)) netByNo.set(it.no, { no: it.no, code: it.code, dirs: [] })
    netByNo.get(it.no).dirs.push({ d: it.dir, p: it.r.pts })
  }
  const netLines = [...netByNo.values()].sort(netSort)
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  let stopCount = 0
  for (const l of netLines) {
    for (const d of l.dirs) {
      stopCount += d.p.length / 2
      for (let i = 0; i + 1 < d.p.length; i += 2) {
        if (d.p[i] < minLng) minLng = d.p[i]
        if (d.p[i] > maxLng) maxLng = d.p[i]
        if (d.p[i + 1] < minLat) minLat = d.p[i + 1]
        if (d.p[i + 1] > maxLat) maxLat = d.p[i + 1]
      }
    }
  }
  const netOut = {
    city: CITY,
    cityName: '武汉',
    updated: new Date().toISOString(),
    source: 'customized.wuhanbus.com /line 站点坐标串',
    bbox: [minLng, minLat, maxLng, maxLat].map((n) => +n.toFixed(5)),
    count: netLines.length,
    dirCount: netLines.reduce((s, l) => s + l.dirs.length, 0),
    stopCount,
    lines: netLines,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(netOut) + '\n', 'utf8')
  const nkb = (fs.statSync(OUT).size / 1024).toFixed(1)
  console.log(`\n写入 ${path.relative(process.cwd(), OUT)}：${netLines.length} 条线路 / ${netOut.dirCount} 个方向 / ${stopCount} 个站点坐标，${nkb} KB，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`bbox = ${netOut.bbox.join(', ')}${skipped ? ` · 不足 2 个有效坐标而未绘的方向 ${skipped} 个（定制线缺位，属上游数据缺失）` : ''}`)
  process.exit(0)
}

// 1) 生成候选：纯数字 + 各前缀
const candidates = []
if (NORMALIZE_ONLY) {
  if (!MERGE) { console.error('--normalize-only 必须配合 --merge（否则无数据可算）'); process.exit(1) }
  if (!fs.existsSync(OUT)) { console.error('找不到已有 JSON：' + OUT); process.exit(1) }
  console.log('仅重算已有 JSON（不联网）')
} else {
  for (let n = FROM; n <= TO; n++) candidates.push(String(n))
  for (const p of PREFIXES) for (let n = FROM; n <= TO; n++) candidates.push(p + n)
  console.log(`扫描范围 ${FROM}~${TO}${PREFIXES.length ? ' + 前缀 [' + PREFIXES.join(', ') + ']' : ''}，候选 ${candidates.length} 条，并发 ${CONCURRENCY}，间隔 ${DELAY}ms`)
}

// 2) 探测方向 0
let done = 0
const found = []
const reasons = {}
const emptySamples = []
const hits = candidates.length ? await pool(candidates, async (code) => {
  const r = await probe(code, 0)
  done++
  if (r.ok) found.push({ code, dto: r.dto, stops: r.stops })
  else {
    const k = r.reason.split(':')[0]
    reasons[k] = (reasons[k] || 0) + 1
    // 20000 但缺基础信息/站点的号：可能是停运、定制线或隐藏接口，先记下来供人工比对
    if (k === 'empty' && emptySamples.length < 15) emptySamples.push(code)
  }
  if (done % 20 === 0 || done === candidates.length) {
    process.stdout.write(`\r  探测 ${fmt(done)}/${candidates.length} · 命中 ${fmt(found.length)}`)
  }
  return r
}, CONCURRENCY) : []
if (candidates.length) {
  process.stdout.write('\n')
  console.log(`方向 0 完成：命中 ${found.length} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const badReasons = Object.entries(reasons).filter(([k]) => k !== 'notfound')
  if (badReasons.length) console.log('  非"不存在"类返回：' + badReasons.map(([k, v]) => `${k}×${v}`).join(' · '))
  if (emptySamples.length) console.log('  其中 empty 号段：' + emptySamples.join(', '))
}

// 3) 反向复核（可选）
const dirsOf = new Map()
if (VERIFY_DIR1 && found.length) {
  let d2 = 0
  await pool(found, async (f) => {
    const r = await probe(f.code, 1)
    dirsOf.set(f.code, r.ok ? [0, 1] : [0])
    // 某方向可能缺站点/起讫站，用另一方向的字段补全（反向的起点就是正向的终点）
    if (r.ok) {
      if (r.stops > f.stops) f.stops = r.stops
      if (!f.dto.startStop) f.dto.startStop = r.dto.endStop
      if (!f.dto.endStop) f.dto.endStop = r.dto.startStop
      if (!f.dto.earlyHour) f.dto.earlyHour = r.dto.earlyHour
      if (!f.dto.lastHour) f.dto.lastHour = r.dto.lastHour
    }
    d2++
    if (d2 % 20 === 0 || d2 === found.length) process.stdout.write(`\r  反向复核 ${fmt(d2)}/${found.length}`)
    return r
  }, CONCURRENCY)
  process.stdout.write('\n')
  const both = [...dirsOf.values()].filter((d) => d.length === 2).length
  console.log(`反向复核完成：双向 ${both} 条 / 仅上行 ${found.length - both} 条`)
} else {
  found.forEach((f) => dirsOf.set(f.code, [0]))
}

// 4) 归一化 + 排序
const byNo = (a, b) => {
  const na = Number(a.no)
  const nb = Number(b.no)
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  if (!isNaN(na)) return -1
  if (!isNaN(nb)) return 1
  return a.no.localeCompare(b.no, 'zh-Hans-CN')
}
const fresh = found.map((f) => ({
  no: f.code,
  // 探测时用的 lineCode（后端内部编码）；不一定等于真实线路号，见下面第 6 步
  code: f.code,
  name: (f.dto.lineName || f.code).trim(),
  start: (f.dto.startStop || '').trim(),
  end: (f.dto.endStop || '').trim(),
  early: (f.dto.earlyHour || '').trim(),
  last: (f.dto.lastHour || '').trim(),
  price: String(f.dto.price == null ? '' : f.dto.price).trim(),
  stops: f.stops,
  type: f.dto.lineType == null ? 0 : f.dto.lineType,
  dirs: dirsOf.get(f.code) || [0],
})).sort(byNo)

// 5) 合并已有数据（分批扫描时保留之前扫到的线路）；旧文档整体留着
let merged = fresh
let oldDoc = null
if (fs.existsSync(OUT)) {
  try { oldDoc = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) { oldDoc = null }
}
if (MERGE && oldDoc) {
  try {
    const old = oldDoc
    const map = new Map((old.lines || []).map((l) => [l.no, l]))
    fresh.forEach((f) => {
      const o = map.get(f.no)
      // 分批扫描可能用了 --no-dir1，或某方向本身缺字段：合并时只能补强，不能把已有信息降级
      if (o) {
        f.dirs = [...new Set([...(o.dirs || []), ...(f.dirs || [])])].sort((x, y) => x - y)
        if (!f.stops) f.stops = o.stops || 0
        if (!f.start) f.start = o.start || ''
        if (!f.end) f.end = o.end || ''
        if (!f.early) f.early = o.early || ''
        if (!f.last) f.last = o.last || ''
        // 已标记停运的线路，即使后端缓存仍返回站点数据也不恢复（人工确认已停运）
        if (o.status === '停运') f.status = '停运'
      }
      map.set(f.no, f)
    })
    merged = [...map.values()].sort(byNo)
    console.log(`合并旧库：旧 ${(old.lines || []).length} 条 → 合并后 ${merged.length} 条`)
  } catch (e) {
    console.log('旧 JSON 解析失败，忽略合并：' + e.message)
  }
}

// 6) 编号规整 + 白名单 + 去重
// ⚠ 后端 lineCode 是内部编码，lineName 才是真实线路号：1001→电1、2001→J1、81→H81。
// 若只按 lineCode 判断，J/H 线会以数字编号溜进库里，还会和「电1」重复。
const isLegalNo = (no) => /^\d+$/.test(no) || PREFIX_OK.some((p) => no.startsWith(p))
const NAME_OK = new RegExp('^(\\d+|电\\d+|BRT\\d+|K\\d+|D\\d+)$')
const FOREIGN = /^(?!BRT|K|D)([A-Za-z]+)\d/ // H81 / J1：字母前缀不在白名单 → 非本集团
const JUNK = /测试|内部/
const kept = []
const dropped = []
const renamed = []
for (const l of merged) {
  if (!l.code) l.code = l.no
  const nm = String(l.name || '').trim()
  if (JUNK.test(nm) || FOREIGN.test(nm)) { dropped.push(l); continue }
  const realNo = NAME_OK.test(nm) ? nm : l.no
  if (!isLegalNo(realNo)) { dropped.push(l); continue }
  if (realNo !== l.no) renamed.push(`${l.no}→${realNo}`)
  l.no = realNo
  kept.push(l)
}
if (renamed.length) console.log(`按 lineName 修正编号 ${renamed.length} 条：${renamed.join(', ')}`)
if (dropped.length) console.log(`剔除非本集团/无效线路 ${dropped.length} 条：${dropped.map((l) => `${l.no}(${l.name})`).join(', ')}`)

// 同一线路可能扫到两种 lineCode（“电1” 与 “1001”）：合并字段，优先保留「编号本身就是 lineCode」的那条
const byReal = new Map()
for (const l of kept) {
  const prev = byReal.get(l.no)
  if (!prev) { byReal.set(l.no, l); continue }
  const keepNew = prev.code !== prev.no && l.code === l.no
  const base = keepNew ? l : prev
  const other = keepNew ? prev : l
  base.dirs = [...new Set([...(base.dirs || []), ...(other.dirs || [])])].sort((x, y) => x - y)
  if (!base.stops) base.stops = other.stops || 0
  if (!base.start) base.start = other.start || ''
  if (!base.end) base.end = other.end || ''
  if (!base.early) base.early = other.early || ''
  if (!base.last) base.last = other.last || ''
  byReal.set(l.no, base)
}
if (byReal.size !== kept.length) console.log(`合并重复编号：${kept.length} 条 → ${byReal.size} 条`)
merged = [...byReal.values()].sort(byNo)

// 7) 运行状态（静态基座）：探测不到站点数据（stops=0）= 已从营运线网撤下 = 停运；
//    有站点数据 = 仍在营运线网。至于「营运中 / 已收班」随一天时间变化，不在静态数据里写死，
//    由前端 utils/lineIndex.js 的 lineStatus() 结合首末班时间实时判定，这里只落一个稳定的基座字段。
for (const l of merged) {
  if (!l.status) l.status = l.stops ? '营运' : '停运'
}
const offCount = merged.filter((l) => l.status === '停运').length
console.log(`运行状态：营运 ${merged.length - offCount} 条 / 停运（无站点数据）${offCount} 条`)

const out = {
  city: CITY,
  cityName: '武汉',
  updated: new Date().toISOString(),
  source: 'customized.wuhanbus.com /line 枚举探测',
  probe: {
    from: FROM,
    to: TO,
    prefixes: PREFIXES,
    dir1Verified: VERIFY_DIR1,
    scanned: candidates.length,
    hit: fresh.length,
    normalizeOnly: NORMALIZE_ONLY || undefined,
  },
  count: merged.length,
  lines: merged,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')

const kb = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`\n写入 ${path.relative(process.cwd(), OUT)}：${merged.length} 条线路，${kb} KB，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('样例：' + merged.slice(0, 5).map((l) => `${l.name}(${l.start}→${l.end}, ${l.stops}站, dirs=${l.dirs.join('/')})`).join(' · '))
