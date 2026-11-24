#!/usr/bin/env node
/**
 * 自动采集编排器（每日 CI / 本地可跑）
 *
 * 串联整条流水线：
 *   线路枚举 → 走向几何(OSRM 兜底) → 高德(foreign / routes-amap / poi-newbus / amap-ids)
 *   → 资产清单 + 线网底图 → 交叉验证报告 → 提交数据到当前分支 → Vercel 自动构建部署
 *
 * 设计原则（对应需求 2/3/5「自动化、减人力、不漏数据」）：
 *   - 缺密钥的步骤自动跳过，保证「免 Key 部分（官方 /line + OSRM）」始终可跑；
 *   - 单步失败不阻断后续；仅「提交 + 部署」失败才让 job 失败；
 *   - 只在数据有变化时提交，避免空提交污染历史；
 *   - 全量重枚举（FULL_SCAN=1）默认只在周日触发，平日仅规范化 + 增量刷新走向。
 *
 * 环境变量：
 *   SCAN_BASE        上游 /line 反代（默认脚本内无则走官方域名）
 *   AMAP_KEY/AMAP_SECRET/AMAP_WEB_COOKIE  高德相关步骤用，缺则跳过
 *   FULL_SCAN=1      全量重枚举线路（含环线），否则仅 normalize-only + 增量刷新
 *   SKIP_DEPLOY=1    已废弃（部署已迁移到 Vercel，本脚本不再构建/部署）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const has = (k) => process.env[k] && String(process.env[k]).length > 0
const AMAP_KEY = has('AMAP_KEY')
const AMAP_COOKIE = has('AMAP_WEB_COOKIE')
const FULL_SCAN = has('FULL_SCAN')
const OVERWRITE = has('OVERWRITE')

// 采集器统一透传的环境变量
const SCAN_ENV = {}
for (const k of ['SCAN_BASE', 'AMAP_KEY', 'AMAP_SECRET', 'AMAP_WEB_COOKIE']) {
  if (process.env[k]) SCAN_ENV[k] = process.env[k]
}

function step(name, cmd, { optional = false } = {}) {
  console.log(`\n=== ${name} ===`)
  try {
    execFileSync('node', cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...SCAN_ENV } })
    return true
  } catch (e) {
    const info = `步骤「${name}」退出码 ${e.status ?? '?'}`
    if (optional) {
      console.log('· 可选步骤跳过：' + info)
      return false
    }
    console.error('× ' + info)
    throw e
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}
function hasStagedChanges() {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT })
    return false // 0 = 无变化
  } catch {
    return true // 非 0 = 有变化
  }
}

// ── 规则：逐线路标注站点数据来源（高德 API vs OSRM 兜底）──
// 集团线路走向有两条来源（见 AGENTS.md「线路静态资产优先」）：
//   source='amap' —— 高德公交 API 官方轨迹 + 高德站点（A，优选）；
//   source='osrm' —— 高德未收录时，用 OSRM 驾车路网近似的兜底走向 + 集团站点（B，非 API 获取）。
// 每次采集（无论全量/增量）都会由 scan-routes.mjs --detect-changes 逐方向重新探测上游
// /line 的站点签名；高德侧命中官方站点即复用。本函数在收尾时扫描全部资产分片，
// 在 Actions 日志里逐条、分组、可读地打印每条线路实际采用的站点来源与存储文件名，
// 并把 OSRM 兜底的线路导出到 reports/osrm-lines.json 随 reports 一起提交。
const COMPANY_GROUPS = [
  { dir: 'jt', label: '公交集团' },
  { dir: 'cc', label: '蔡城公交' },
  { dir: 'ml', label: '木兰公交' },
  { dir: 'hq', label: '汉奇公交' },
]

// 读取线路库 no -> org，用于在日志里显示「具体营运公司」
function loadLineOrgMap() {
  const map = {}
  const p = path.join(ROOT, 'src/static/lines/lines.json')
  try {
    const lib = JSON.parse(fs.readFileSync(p, 'utf8'))
    const arr = Array.isArray(lib.lines) ? lib.lines : (Array.isArray(lib) ? lib : [])
    for (const l of arr) if (l && l.no) map[l.no] = l.org || ''
  } catch {}
  return map
}

// 把集团 org 全名压成「第三营运公司」这类短标签
function shortOrg(org, fallback) {
  if (!org) return fallback
  const m = String(org).match(/第([一二三四五六七八九])营运公司/)
  return m ? `公交集团·第${m[1]}营运公司` : fallback
}

function scanStationSources() {
  const linesRoot = path.join(ROOT, 'src/static/lines')
  const orgMap = loadLineOrgMap()
  const all = []
  for (const { dir, label } of COMPANY_GROUPS) {
    const full = path.join(linesRoot, dir)
    if (!fs.existsSync(full)) continue
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.json'))) {
      let data
      try {
        data = JSON.parse(fs.readFileSync(path.join(full, file), 'utf8'))
      } catch {
        continue
      }
      for (const no of Object.keys(data.lines || {})) {
        const line = data.lines[no]
        const dirs = (line && line.dirs) || {}
        const d0 = dirs['0'], d1 = dirs['1']
        const amapDirs = ['0', '1'].filter((k) => dirs[k] && dirs[k].source === 'amap')
        const osrmDirs = ['0', '1'].filter((k) => dirs[k] && dirs[k].source === 'osrm')
        if (!amapDirs.length && !osrmDirs.length) continue
        all.push({
          no,
          name: (line && (line.name || line.lineName)) || '',
          company: dir === 'jt' ? shortOrg(orgMap[no], label) : label,
          group: label,
          shard: `${dir}/${file}`,
          file: file,
          amapDirs,
          osrmDirs,
          stops: (d0 && d0.stops ? d0.stops.length : (d1 && d1.stops ? d1.stops.length : 0)),
        })
      }
    }
  }
  const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true })
  all.sort(byNo)
  return all
}

function writeStationSourceReport() {
  const all = scanStationSources()
  const osrmRows = all.filter((r) => r.osrmDirs.length)
    .map((r) => ({ no: r.no, name: r.name, company: r.company, shard: r.shard, osrmDirs: r.osrmDirs }))

  // ── 可读日志：每次采集后逐条标注全部线路的站点来源 ──
  const pad = (s, n) => {
    const str = String(s == null ? '' : s)
    // 中文按 2 列宽计，保证等宽对齐
    const w = [...str].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)
    return str + ' '.repeat(Math.max(0, n - w))
  }
  console.log('\n' + '═'.repeat(72))
  console.log('  线路站点数据来源清单')
  console.log('  ★ 每次执行 Actions 都重新获取全部线路的站点信息：逐方向探测上游 /line，高德官方站点命中即复用')
  console.log('═'.repeat(72))
  for (const { label } of COMPANY_GROUPS) {
    const rows = all.filter((r) => r.group === label)
    if (!rows.length) continue
    const amapCount = rows.filter((r) => r.amapDirs.length && !r.osrmDirs.length).length
    const osrmCount = rows.filter((r) => r.osrmDirs.length).length
    console.log(`\n【${label}】高德站点 ${amapCount} 条 · OSRM 兜底 ${osrmCount} 条`)
    console.log('  ' + '─'.repeat(68))
    for (const r of rows) {
      const dirDesc = (ds) => ds.map((k) => (k === '0' ? '上行' : '下行')).join('/')
      const src = r.osrmDirs.length && r.amapDirs.length
        ? `高德站点(${dirDesc(r.amapDirs)}) + OSRM兜底(${dirDesc(r.osrmDirs)})`
        : r.osrmDirs.length
          ? `无高德站点数据，正在使用 OSRM 兜底(${dirDesc(r.osrmDirs)})`
          : `正在使用高德地图站点数据信息(${dirDesc(r.amapDirs)})`
      console.log(`  ${pad(r.no, 14)}${pad(r.company, 26)} ${src}，信息存储文件名『${r.file}』`)
    }
  }
  console.log('═'.repeat(72))
  console.log(`  合计 ${all.length} 条：高德站点 ${all.filter((r) => r.amapDirs.length && !r.osrmDirs.length).length} 条 · OSRM 兜底 ${osrmRows.length} 条`)
  console.log('═'.repeat(72) + '\n')

  const report = {
    updatedAt: new Date().toISOString(),
    rule: '每条线路按方向标注站点来源：source=amap（高德官方站点）或 source=osrm（高德未收录、OSRM 兜底）。每次采集逐方向重新探测上游 /line 站点签名；高德官方站点命中即复用。',
    total: osrmRows.length,
    lines: osrmRows,
  }
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'reports/osrm-lines.json'), JSON.stringify(report, null, 2) + '\n')
  return osrmRows.length
}

// ── 1. 线路枚举：全量(周) / 仅规范化(日) ──
if (FULL_SCAN) {
  step('线路枚举（全量 + 环线）', ['scripts/scan-lines.mjs', '--from', '1', '--to', '999', '--loops', '--merge', '--no-dir1', '--delay', '80'])
} else {
  // 日更不重新打 API：仅把现有资产重新规范化/排序，保持 lines.json 可复现、稳定
  step('线路枚举（规范化）', ['scripts/scan-lines.mjs', '--normalize-only', '--merge'])
}

// ── 2. 走向几何（B：OSRM 免 Key 驾车路网近似；高德未收录的线路兜底）──
//   非全量轮次开启 --detect-changes：强制重探上游 /line，按站点签名变化登记「变化线路」
//   （scripts/.changed-lines.txt），供步骤 3 增量重拉高德走向（实现「线路更新后获取最新走向」）。
if (FULL_SCAN) {
  step('走向几何（OSRM 贴路）', ['scripts/scan-routes.mjs', '--delay', '60', '--osrm-delay', '400'])
} else {
  step('走向几何 + 增量检测（OSRM 贴路）', ['scripts/scan-routes.mjs', '--delay', '60', '--osrm-delay', '400', '--detect-changes'])
}

// ── 2.5 营运公司（在线车辆自编号反推，只补强不降级）──
//   每轮捞当时有在线车的线路补 org；单次覆盖有限，靠定时反复跑累积（buspedia 未收录的 D/K/YX 线靠它补）。
//   注意顺序：必须在步骤 1 的 scan-lines --merge 之后跑，否则新写 org 可能被那一步的规范化覆盖。
step('营运公司（在线车辆反推）', ['scripts/scan-org-live.mjs'], { optional: true })

// ── 3~6. 高德相关（主辅链路，失败不阻断）──
// 主方案 = SSR（ditu.amap.com/ssr/api，免 Web 服务 Key，仅需会话 Cookie）：
//   返回站点 xy_coords / POI id / 换乘 / 公司 / 长度 / 包围盒，--overwrite 直接覆盖
//   route + stops，作为最终落盘的权威数据源。配额池与 Key 完全独立。
// 辅助方案 = linename 主链路（需 AMAP_KEY）：只补 SSR 未命中 / 台账未完成的线路，
//   用 --retry-unmatched（不带 --force），避免反过来覆盖 SSR 已写好的数据。
//
// 依赖说明：SSR 需要资产里已有 amap.id（线路 POI id）。id 由「POI id 回填」步骤
//   （scan-amap-ids.mjs，需 Key+Cookie）写入；首次全库无 id 时先跑这一步，后续 SSR 自持。
// 执行顺序：① POI id 回填（前置）→ ② SSR 主方案覆盖 → ③ 主链路辅助补漏 → ④ 站点补齐。

// ① POI id 回填：SSR 的前置，把 amap.id 写进资产（无 Key 时跳过，SSR 用已有 id）
if (AMAP_KEY) {
  step('高德 POI id 回填（SSR 前置）', ['scripts/scan-amap-ids.mjs'], { optional: true })
}

// ② SSR 主方案：--overwrite 让 SSR 的站点/走向成为最终数据；无 Key 也能独立跑
if (AMAP_COOKIE) {
  step('高德 SSR 主方案（站点·走向·换乘）', ['scripts/scan-poi-newbus.mjs', '--overwrite', '--delay', '350'], { optional: true })
} else {
  console.log('\n（跳过高德 SSR 主方案：未配置 AMAP_WEB_COOKIE，将退回主链路兜底）')
}

// ③ 主链路辅助补漏 + ④ 站点补齐（需 AMAP_KEY）
if (AMAP_KEY) {
  step('非集团线路（蔡城/木兰/汉奇）', ['scripts/scan-foreign.mjs', '--delay', '1200'], { optional: true })
  // 辅助：只处理台账未完成的线路（SSR 覆盖的大多在台账为 done，自动跳过），不再全量覆盖。
  // --batch-size 3 + queryAmap 内 3 次退避重试，降低限流导致的「查无此线」误判。
  step('高德主链路（辅助补漏）', ['scripts/scan-routes-amap.mjs', '--retry-unmatched', '--batch-size', '3', '--delay', '1100', '--ci-log'], { optional: true })
  // 补齐仍残留的半成品：source 已是 amap、但站点还是集团 MD5 站号；已换高德站的不动。
  step('高德站点补齐（集团站 → 高德站）', ['scripts/scan-routes-amap.mjs', '--backfill-stops', '--delay', '1100', '--ci-log'], { optional: true })
} else {
  console.log('\n（跳过高德主链路辅助步骤：未配置 AMAP_KEY）')
}

// ── 7. 资产清单 + 线网底图 ──
step('资产清单 manifest', ['scripts/build-manifest.mjs'])
step('非集团线网底图', ['scripts/build-foreign-net.mjs'])

// ── 8. 交叉验证（官方 vs 高德，输出质量报告）──
step('交叉验证报告', ['scripts/validate-cross.mjs'], { optional: true })

// ── 8.5 规则：逐线路标注站点来源（高德 API / OSRM 兜底）──
//   Actions 日志逐条打印全部线路的站点来源（公司/线路/文件名），随 reports 提交 OSRM 清单。
const osrmTotal = writeStationSourceReport()
console.log(`· OSRM 兜底（非 API 获取）线路 ${osrmTotal} 条 → reports/osrm-lines.json`)

// ── 9. 提交数据到当前分支（main）──
const DATA_PATHS = [
  'src/static/lines',
  'src/static/net',
  'reports',
  'scripts/.amap-progress.json',
  'scripts/.stops-sig.json',
]
// 部分路径（如 .amap-progress.json）仅在对应采集步骤运行时才生成；CI 未配 AMAP_KEY 时该文件不存在。
// 直接 git add 会因 pathspec 不匹配整体报错退出（status 128），故先过滤出实际存在的路径再 add，
// 兼容任意 git 版本（避免依赖 --ignore-missing 的版本相关行为）。
const existingPaths = DATA_PATHS.filter((p) => fs.existsSync(p))
git(['add', ...existingPaths])
if (hasStagedChanges()) {
  console.log('\n' + git(['diff', '--cached', '--stat']))
  git(['config', 'user.name', 'github-actions[bot]'])
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  git(['commit', '-m', `数据: 自动采集更新 ${new Date().toISOString().slice(0, 10)}`])
  // CI 下 actions/checkout 多为 detached HEAD，不能用 `git push origin HEAD`（会报
  // “not currently on a branch”）。显式指定远端分支引用，本地无 GITHUB_REF_NAME 时回退当前分支/main。
  let pushBranch = process.env.GITHUB_REF_NAME
  if (!pushBranch) {
    try { const b = git(['rev-parse', '--abbrev-ref', 'HEAD']); pushBranch = b === 'HEAD' ? 'main' : b } catch { pushBranch = 'main' }
  }
  // 先 fetch 远端，避免非 fast-forward 被拒（远端可能有其他 CI 轮次或人工提交）
  try {
    git(['fetch', 'origin', pushBranch])
    console.log(`· 已 fetch 远端 ${pushBranch}`)
  } catch (e) {
    console.log(`· fetch 失败（继续尝试推送）：${e.message}`)
  }
  // 远端有新提交时先 rebase 本地改动，再推送
  try {
    git(['rebase', `origin/${pushBranch}`])
    console.log(`· 已 rebase 到 origin/${pushBranch}`)
  } catch (e) {
    console.log(`· rebase 冲突，回退并改用 merge：${e.message}`)
    try { git(['rebase', '--abort']) } catch {}
    try {
      git(['merge', '--no-edit', `origin/${pushBranch}`])
      console.log(`· 已 merge origin/${pushBranch}`)
    } catch (me) {
      console.error('× merge 也失败，放弃推送：' + me.message)
      throw me
    }
  }
  git(['push', 'origin', `HEAD:refs/heads/${pushBranch}`])
  console.log(`· 数据已提交并推送到分支 ${pushBranch}`)
} else {
  console.log('\n· 数据无变化，跳过提交')
}

// ── 10. 部署：已迁移到 Vercel（main push 自动构建部署）──
// 原「构建 H5 + 强推 pages 分支」已移除：GitHub Pages 已关闭、pages 分支已删除。
// CI 只需把采集数据提交到 main，Vercel 会自动触发构建部署，无需在此重复构建。
console.log('\n· 部署交由 Vercel：数据已提交到 main，Vercel 会自动构建部署')
