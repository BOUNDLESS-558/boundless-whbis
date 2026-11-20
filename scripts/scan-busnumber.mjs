/**
 * 车辆完整自编号采集（buspedia.top 车队页 → bus-number-map.json）
 *
 * 背景：后端 /detailData 的 busId = MD5(orgBusId)，只能还原出纯数字自编号
 *   （如 22517）。buspedia 的车队页列出「完整自编号段」，形如
 *   `125B2023~2025`（1公司 + 25 + 车型字母B + 车号2023~2025），
 *   用户希望优先显示这种完整形式。
 *
 * 数据源（需登录，用户 2026-11-20 提供账号）：
 *   1) https://buspedia.top/comp/zek3io          —— 武汉集团车队表，提取所有 /model/{id} 车型
 *   2) https://buspedia.top/comp/zek3io/fleet/{id} —— 每个车型页的「自编号段」字段（第一个 .data-cell）
 *
 * 编号段格式：每行 `{公司号}{25}{车型字母}{车号范围}`，7 行对应 1~7 公司。
 *   范围写法：`2023~2025`（连号）、`311~313, 315~321`（多段）、`2043`（单号）。
 *
 * 用法：
 *   $env:BP_USER="账号"; $env:BP_PASS="密码"; node scripts/scan-busnumber.mjs           # 全量采集
 *   node scripts/scan-busnumber.mjs --limit 30      # 只抓前 30 个车型（验证用）
 *   node scripts/scan-busnumber.mjs --fresh         # 忽略断点，重新抓
 *   node scripts/scan-busnumber.mjs --parse-only    # 只从已抓原始数据生成映射表，不联网
 *
 * 环境变量：
 *   BP_USER / BP_PASS   buspedia 账号（必需，除非 --parse-only）
 *   EDGE_PATH           Edge 可执行文件（默认系统安装路径）
 *
 * 设计：
 *   - Playwright + Edge 渲染（该站 API 需登录且 Node 直连不稳，浏览器渲染最可靠）；
 *   - 强重试 + 断点续跑：每抓一个车型立即落盘 .busnumber-runtime.json，中断后重跑自动续；
 *   - 认证靠浏览器登录后 localStorage 的 JWT，Cookie 过期会重新登录。
 *
 * 依赖：playwright-core（脚本内按需从 .tmp-pw 加载；CI 用 npx playwright 或预装）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(__dirname, '.busnumber-runtime.json')
const OUT = path.resolve(ROOT, 'src/static/bus-number-map.json')
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const USER = process.env.BP_USER || ''
const PASS = process.env.BP_PASS || ''
const COMP = 'zek3io' // 武汉公交集团在 buspedia 的 comp id
const BASE = 'https://buspedia.top'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)
const LIMIT = Number(argOf('limit', 0))
const CONCURRENCY = Math.max(1, Number(process.env.BP_CONCURRENCY || argOf('concurrency', 4)))
const FRESH = has('fresh')
const PARSE_ONLY = has('parse-only')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 动态加载 playwright-core（优先项目 .tmp-pw，其次全局） */
async function loadPlaywright() {
  for (const p of [
    path.join(ROOT, '.tmp-pw/node_modules/playwright-core/index.js'),
    'playwright-core',
  ]) {
    try {
      const mod = p.endsWith('.js') ? (await import(pathToFileURL(p).href)).default : (await import(p)).default
      if (mod && mod.chromium) return mod
    } catch (e) { /* 试下一个 */ }
  }
  throw new Error('找不到 playwright-core。请运行：npm install playwright-core --no-save --prefix ./.tmp-pw')
}

// ——— 解析：编号段 → 完整编号映射 ———
/**
 * 解析一行编号段，如 "325N340~343, 345~353, 355"
 * @returns {Array<{full:string, company:number, letter:string, num:string}>}
 */
export function expandSegment(line) {
  const out = []
  // 格式：公司号(1位) + 批次码(1~2位数字) + 车型字母(可选) + 车号范围
  // 例：125B2023、115Y562~596、105A123、16Y0001~0037、325G322
  const m = String(line).trim().match(/^(\d)(\d{1,2})?([A-Z])?(.+)$/)
  if (!m) return out
  const company = Number(m[1])
  const letter = m[3] || ''
  const body = m[4]
  // 拆分逗号段，展开 ~ 范围
  for (const part of body.split(',')) {
    const p = part.trim()
    const rg = p.match(/^(\d+)~(\d+)$/)
    if (rg) {
      const a = Number(rg[1]), b = Number(rg[2])
      const width = rg[1].length // 保留原文位数（如 001~050 补零到 3 位，避免误匹配无零的短编号）
      if (b >= a && b - a <= 2000) {
        for (let n = a; n <= b; n++) {
          const s = String(n).padStart(width, '0')
          out.push({ company, letter, num: s, full: `${company}${m[2] || ''}${letter}${s}` })
        }
      }
    } else if (/^\d+$/.test(p)) {
      out.push({ company, letter, num: p, full: `${company}${m[2] || ''}${letter}${p}` })
    }
  }
  return out
}

function buildMap(rows) {
  const byFull = {}
  const byNum = {} // num → [full]（跨公司/车型可能重复，保留全部）
  let segLines = 0
  for (const r of rows) {
    for (const line of (r.segments || '').split('\n')) {
      if (!line.trim()) continue
      segLines++
      for (const x of expandSegment(line)) {
        byFull[x.full] = { company: x.company, letter: x.letter, num: x.num, model: r.model, modelId: r.id }
        // 系统编号 = 公司号(首位) + 车号，中间不含批次码/字母
        //   buspedia 319N2379（3公司+19批次+N车型+2379车号）→ 系统 32379
        // 车号可能带前导零（如 322N001），系统 MD5 还原无零 → 同时登记去零版本
        const keys = new Set([
          `${x.company}${x.num}`,
          `${x.company}${String(Number(x.num))}`,
        ])
        for (const key of keys) {
          const arr = (byNum[key] ||= [])
          if (!arr.includes(x.full)) arr.push(x.full)
        }
      }
    }
  }
  return {
    updated: new Date().toISOString(),
    source: 'buspedia.top/comp/zek3io/fleet/*（需登录采集）',
    stat: { models: rows.filter((r) => r.segments).length, segmentLines: segLines, fullNumbers: Object.keys(byFull).length },
    byFull,
    byNum,
  }
}

if (PARSE_ONLY) {
  const state = JSON.parse(fs.readFileSync(RUNTIME, 'utf8'))
  const rows = state.models.map((m) => ({ ...m, segments: state.done[m.id] || '' }))
  const out = buildMap(rows)
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(`已生成 ${path.relative(ROOT, OUT)}：${out.stat.fullNumbers} 个完整编号 / ${out.stat.segmentLines} 行编号段 / ${out.stat.models} 车型`)
  process.exit(0)
}

if (!USER || !PASS) {
  console.error('× 缺少 BP_USER / BP_PASS 环境变量。示例：')
  console.error('  $env:BP_USER="账号"; $env:BP_PASS="密码"; node scripts/scan-busnumber.mjs')
  process.exit(1)
}

const pw = await loadPlaywright()
const { chromium } = pw
// 用系统代理（本机 127.0.0.1:7890），与浏览器正常上网一致；ENV 可覆盖
const PROXY = process.env.BP_PROXY || process.env.HTTPS_PROXY || 'http://127.0.0.1:7890'
const launchOpts = { executablePath: EDGE, headless: true }
if (PROXY) launchOpts.proxy = { server: PROXY, bypass: 'localhost,127.0.0.1' }
const browser = await chromium.launch(launchOpts)

let state = { models: [], done: {} }
if (!FRESH && fs.existsSync(RUNTIME)) { try { state = JSON.parse(fs.readFileSync(RUNTIME, 'utf8')) } catch {} }

async function goto(p, url, tries = 6, waitMs = 1000) {
  for (let t = 1; t <= tries; t++) {
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
      await p.waitForTimeout(waitMs)
      return true
    } catch (e) {
      if (t === tries) return false
      await sleep(1500 * t)
    }
  }
}

/** 读取已保存的登录态 token（未过期则直接注入，跳过不稳定的表单登录） */
function savedAuth() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '.buspedia-state.json'), 'utf8'))
    const origin = s.origins.find((o) => o.origin.includes('buspedia'))
    const auth = JSON.parse(origin.localStorage.find((x) => x.name === 'auth').value)
    const clientId = s.cookies.find((c) => c.name === 'busdaz-client-id')?.value || ''
    if (auth.token && auth.expiration && Date.now() < auth.expiration) return { auth, clientId }
  } catch {}
  return null
}

/** 创建登录页：重新登录账号，延长 Cookie 时间，确保稳定 */
async function makeLoggedPage() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const c = await browser.newContext()
    const p = await c.newPage()
    try {
      // 1. 打开首页，等待登录按钮出现
      let ready = false
      for (let t = 1; t <= 8; t++) {
        if (!await goto(p, BASE + '/', 3, 1500)) continue
        try {
          await p.getByRole('button', { name: '登录', exact: true }).first().waitFor({ timeout: 8000 })
          ready = true
          break
        } catch {}
      }
      if (!ready) throw new Error('首页登录按钮未出现')

      // 2. 点击登录按钮，切换到账号登录 tab
      await p.getByRole('button', { name: '登录', exact: true }).first().click({ timeout: 15000 })
      await p.waitForTimeout(800)
      await p.getByRole('button', { name: '账号登录' }).click({ timeout: 15000 })
      await p.waitForTimeout(500)

      // 3. 填写用户名和密码
      await p.locator('input[name=login]').fill(USER)
      await p.locator('input[name=password]').fill(PASS)

      // 4. 点击登录提交
      await p.getByRole('button', { name: '登录', exact: true }).last().click({ timeout: 15000 })

      // 5. 等待登录完成，检查 token
      await p.waitForTimeout(3000)
      const auth = await p.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('auth') || '{}') } catch { return {} }
      })
      if (!auth.token) throw new Error('无 token')

      // 6. 延长 Cookie 时间：设置更长的过期时间
      const cookies = await c.cookies()
      for (const ck of cookies) {
        if (ck.name === 'busdaz-client-id' || ck.name.includes('token') || ck.name.includes('session')) {
          await c.addCookies([{ ...ck, expires: Math.floor(Date.now() / 1000) + 86400 * 7 }])
        }
      }

      // 7. 存盘，后续复用
      await ctxStorageSave(p, c)
      return { ctx: c, page: p, reused: false }
    } catch (e) {
      console.log(`  登录尝试 ${attempt}/5 失败：${e.message.slice(0, 50)}`)
      await c.close()
      await sleep(2000 * attempt)
    }
  }
  throw new Error('登录失败（已重试5次）')
}

async function ctxStorageSave(p, c) {
  try {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 })
    const state = await c.storageState()
    fs.writeFileSync(path.join(__dirname, '.buspedia-state.json'), JSON.stringify(state, null, 2))
  } catch {}
}

// 车型列表：用独立登录页抓一次
if (!state.models.length) {
  console.log('登录并读取车型列表…')
  const { ctx: c0, page: p0 } = await makeLoggedPage()
  if (!await goto(p0, `${BASE}/comp/${COMP}`, 6, 2500)) { await c0.close(); throw new Error('公司页打不开') }
  state.models = await p0.evaluate(() => {
    const out = []
    for (const a of document.querySelectorAll('a[href^="/model/"]')) {
      const id = a.getAttribute('href').split('/').pop()
      const text = a.innerText.trim()
      if (id && text && /^[A-Z0-9\-]+$/.test(text)) out.push({ id, model: text })
    }
    return [...new Map(out.map((m) => [m.id, m])).values()]
  })
  fs.writeFileSync(RUNTIME, JSON.stringify(state, null, 2))
  await c0.close()
  console.log(`车型 ${state.models.length} 个`)
}

// 重试模式：把空值视为待抓（--retry），默认只抓从未抓过的
if (has('retry')) for (const k of Object.keys(state.done)) if (!state.done[k]) delete state.done[k]
const todo = (LIMIT ? state.models.slice(0, LIMIT) : state.models).filter((m) => state.done[m.id] === undefined || state.done[m.id] === '')
console.log(`待抓 ${todo.length} / ${state.models.length} 车型（${CONCURRENCY} 并发）`)
// 单线程抓取：一个登录页，逐个抓，每个立即落盘
console.log(`  登录…`)
let { ctx: c0, page: p0 } = await makeLoggedPage()
let n = 0
let consecutiveEmpty = 0
for (const m of todo) {
  const url = `${BASE}/comp/${COMP}/fleet/${m.id}`
  let cell = ''
  for (let t = 1; t <= 3; t++) {
    if (await goto(p0, url, 4, 800)) {
      cell = await p0.evaluate(() => document.querySelector('.data-cell')?.innerText?.trim() || '').catch(() => '')
      if (cell) { consecutiveEmpty = 0; break }
    }
    // 连续抓不到：强制表单登录刷新 token（旧 token 可能已作废）
    if (t === 1 && consecutiveEmpty >= 1) {
      try {
        console.log('    ↻ 登录态失效，强制重新登录…')
        const fresh = await makeLoggedPage()
        await c0.close(); c0 = fresh.ctx; p0 = fresh.page
      } catch (e) { console.log('    重登失败：' + e.message.slice(0, 40)) }
    }
  }
  if (!cell) consecutiveEmpty++
  state.done[m.id] = cell
  fs.writeFileSync(RUNTIME, JSON.stringify(state, null, 2))
  n++
  const okCount = Object.values(state.done).filter(Boolean).length
  console.log(`  [${n}/${todo.length}] ${m.model}: ${cell ? '✓' : '✗ 空'}（累计有数据 ${okCount}）`)
}
await c0.close()
await browser.close()

const rows = state.models.map((m) => ({ ...m, segments: state.done[m.id] || '' }))
const out = buildMap(rows)
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`\n完成：${out.stat.models} 车型 / ${out.stat.fullNumbers} 个完整编号 → ${path.relative(ROOT, OUT)}`)
