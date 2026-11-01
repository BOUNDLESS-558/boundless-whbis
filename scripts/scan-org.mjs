/**
 * 营运公司采集：buspedia.top → src/data/lines.json 的 org 字段
 *
 * 后端线路接口不返回营运公司。buspedia.top（巴士派迪）维护了武汉公交集团
 * 全部线路的分公司归属，数据以 Nuxt SSR 内嵌在 /comp/zek3io/lines 页面中。
 * 本脚本一次性拉取该页面，解析 __NUXT_DATA__ 得到 线路名→营运公司 映射，
 * 然后按 lines.json 中的 no 字段逐条匹配并写入 org（全名，如
 * 「武汉市公共交通集团有限责任公司第五营运公司」）。
 *
 * 相比旧版 8684 逐条搜索：
 *   - 覆盖率更高（含 D 线，8684 不收录）
 *   - 只需 1 次网络请求（而非数百次）
 *   - 数据源本身按公司分组，更权威
 *
 * 约定（与 scan-lines 同一套哲学）：
 *   - 只补强不降级：已有 org 的行默认跳过（--force 才覆盖）；
 *   - 抓的是事实数据（线路号 → 公司名），不复制文案内容。
 *
 * 用法：
 *   node scripts/scan-org.mjs            # 全量补空
 *   node scripts/scan-org.mjs --dry      # 只统计不写文件
 *   node scripts/scan-org.mjs --force    # 重拉全部（覆盖已有 org）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '../src/data/lines.json')
const BP_URL = 'https://buspedia.top/comp/zek3io/lines'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130'
const TIMEOUT = Number(process.env.BP_TIMEOUT || 180000)
const RETRIES = Number(process.env.BP_RETRIES || 3)
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const FORCE = argv.includes('--force')

const db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const lines = db.lines || []

// —— 1. 拉取 buspedia 页面 ——
async function fetchPage() {
  for (let i = 0; i < RETRIES; i++) {
    try {
      console.log(`正在拉取 ${BP_URL}（第 ${i + 1} 次）...`)
      const r = await fetch(BP_URL, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return await r.text()
    } catch (e) {
      console.log(`  失败: ${e.message}`)
      if (i < RETRIES - 1) await new Promise((r) => setTimeout(r, 5000))
    }
  }
  throw new Error('无法获取 buspedia 页面（重试 ' + RETRIES + ' 次均失败）')
}

// —— 2. 解析 Nuxt 3 __NUXT_DATA__（扁平引用数组） ——
function parseNuxtData(html) {
  const marker = '__NUXT_DATA__'
  const start = html.indexOf(marker)
  if (start < 0) throw new Error('未找到 __NUXT_DATA__')
  const jsonStart = html.indexOf('>', start + marker.length) + 1
  const jsonEnd = html.indexOf('</script>', jsonStart)
  const arr = JSON.parse(html.slice(jsonStart, jsonEnd))

  // Resolve helpers for Nuxt 3 flat-array format
  function resolveObj(idx) {
    const v = arr[idx]
    if (!v || typeof v !== 'object') return v
    if (Array.isArray(v)) {
      if (v[0] === 'ShallowReactive' || v[0] === 'Reactive') return resolveObj(v[1])
      return v
    }
    const out = {}
    for (const [k, ref] of Object.entries(v)) {
      if (typeof ref === 'number') {
        const rv = arr[ref]
        if (rv && typeof rv === 'object' && !Array.isArray(rv)) out[k] = resolveObj(ref)
        else if (Array.isArray(rv)) out[k] = resolveArr(ref)
        else out[k] = rv
      } else out[k] = ref
    }
    return out
  }
  function resolveArr(idx) {
    const v = arr[idx]
    if (!Array.isArray(v)) return v
    if (v[0] === 'ShallowReactive' || v[0] === 'Reactive') return resolveArr(v[1])
    return v.map((item) => {
      if (typeof item === 'number') {
        const iv = arr[item]
        if (iv && typeof iv === 'object' && !Array.isArray(iv)) return resolveObj(item)
        if (Array.isArray(iv)) return resolveArr(item)
        return iv
      }
      return item
    })
  }

  // Navigate: arr[1] = {data: refIdx, ...} → arr[data] = payload
  const meta = arr[1]
  const dataIdx = meta && typeof meta.data === 'number' ? meta.data : 2
  const payload = resolveObj(dataIdx)
  const compLines = payload['comp-lines-zek3io']
  if (!compLines || !compLines.lines) throw new Error('未找到 comp-lines-zek3io 数据')
  return compLines.lines // [categories[], routes[]]
}

// —— 3. 构建 线路名 → 公司全名 映射 ——
const GROUP_PREFIX = '武汉市公共交通集团有限责任公司'
// 公司名归一：「第X运营公司」→「第X营运公司」
function normalizeCompany(name) {
  if (!name) return ''
  // 统一「运营」→「营运」
  let n = name.replace(/运营/g, '营运')
  // 多公司取第一个（如 "第二营运公司,第三营运公司" 这种异常）
  if (n.includes(',')) n = n.split(',')[0].trim()
  // 通恒公司不是集团子公司，跳过
  if (n === '通恒公司') return ''
  // "已停运线路" 不是公司
  if (n === '已停运线路') return ''
  return GROUP_PREFIX + n
}

// 从 buspedia 线路名提取可匹配的 no（去掉「路」及括号/破折号后的附加说明）
function extractNo(bpName) {
  // "D522路（生物城专线）" → "D522"
  // "D300路-江汉揽胜旅游巴士" → "D300"
  // "38路" → "38"
  // "定制微公交6路" → "定制微公交6"
  // "D217-1路" → "D217-1"
  let n = bpName.trim()
  // 去掉括号及其内容
  n = n.replace(/[（(].*?[）)]/g, '')
  // 去掉「-xxx」后缀（但保留 D217-1 这种数字后缀）
  n = n.replace(/-[^\d].*$/, '')
  // 去掉末尾「路」
  n = n.replace(/路$/, '')
  return n
}

function buildMapping([categories, routes]) {
  const map = new Map() // normalized no → company full name
  for (const route of routes) {
    const name = route.name || ''
    const subs = route.sub || []
    const company = normalizeCompany(subs[0] || '')
    if (!company) continue
    const no = extractNo(name)
    if (!no) continue
    // 精确匹配键（大小写统一）
    const key = no.toUpperCase()
    // 不覆盖已有映射（先到先得，避免重复条目互相覆盖）
    if (!map.has(key)) map.set(key, company)
  }
  return map
}

// —— 4. 匹配 lines.json ——
const html = await fetchPage()
const [categories, routes] = parseNuxtData(html)
console.log(`buspedia 数据：${routes.length} 条线路，${categories.length} 个分类`)
const mapping = buildMapping([categories, routes])
console.log(`有效映射：${mapping.size} 条`)

let hit = 0, skip = 0, miss = 0
for (const l of lines) {
  if (l.org && !FORCE) { skip++; continue }
  const key = String(l.no).toUpperCase()
  const company = mapping.get(key)
  if (company) {
    l.org = company
    hit++
  } else {
    miss++
  }
}

// 汉奇块也要静态归属：汉奇车辆编号是车型码、首位不表征收营运公司，
// 线路级徽标只能靠这里写入的 org（buspedia 线路名与 lineName 同口径，直接整名匹配）。
let hqHit = 0
const hqLines = (db.hanqi && db.hanqi.lines) || []
for (const l of hqLines) {
  if (l.org && !FORCE) continue
  const company = mapping.get(String(l.lineName || '').toUpperCase())
  if (company) { l.org = company; hqHit++ }
}

// —— 统计 ——
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const dist = {}
for (const l of lines) {
  if (!l.org) continue
  const m = String(l.org).match(/第([一二三四五六七八九])营运公司/)
  const key = m ? `第${CN[m[1]]}公司` : '其他/非集团'
  dist[key] = (dist[key] || 0) + 1
}
console.log('\n==== 采集结果 ====')
console.log(`本轮：命中 ${hit} / 跳过(已有) ${skip} / 未命中 ${miss}；汉奇块补写 ${hqHit} 条（共 ${hqLines.length} 条）`)
console.log('全库 org 分布：', JSON.stringify(dist), '（空 ' + lines.filter((l) => !l.org).length + ' 条）')

if (DRY) {
  console.log('--dry：未写文件')
} else if (hit + hqHit > 0) {
  db.updated = new Date().toISOString()
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2) + '\n', 'utf8')
  console.log(`√ 已写回 ${path.relative(process.cwd(), FILE)}（新增/更新 ${hit + hqHit} 条 org）`)
} else {
  console.log('无新增命中，不写文件')
}
