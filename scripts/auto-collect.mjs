#!/usr/bin/env node
/**
 * 自动采集编排器（每日 CI / 本地可跑）
 *
 * 串联整条流水线：
 *   线路枚举 → 走向几何(OSRM 兜底) → 高德(foreign / routes-amap / poi-newbus / amap-ids)
 *   → 资产清单 + 线网底图 → 交叉验证报告 → 提交数据到当前分支 → 构建 H5 → 部署 Pages
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
 *   SKIP_DEPLOY=1    只采集不构建/部署（本地自测用）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const ROOT = process.cwd()
const has = (k) => process.env[k] && String(process.env[k]).length > 0
const AMAP_KEY = has('AMAP_KEY')
const AMAP_COOKIE = has('AMAP_WEB_COOKIE')
const FULL_SCAN = has('FULL_SCAN')
const SKIP_DEPLOY = has('SKIP_DEPLOY')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

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

// ── 1. 线路枚举：全量(周) / 仅规范化(日) ──
if (FULL_SCAN) {
  step('线路枚举（全量 + 环线）', ['scripts/scan-lines.mjs', '--from', '1', '--to', '999', '--loops', '--merge', '--no-dir1', '--delay', '80'])
} else {
  // 日更不重新打 API：仅把现有资产重新规范化/排序，保持 lines.json 可复现、稳定
  step('线路枚举（规范化）', ['scripts/scan-lines.mjs', '--normalize-only', '--merge'])
}

// ── 2. 走向几何（B：OSRM 免 Key 驾车路网近似；高德未收录的线路兜底）──
step('走向几何（OSRM 贴路）', ['scripts/scan-routes.mjs', '--delay', '60', '--osrm-delay', '400'])

// ── 3~6. 高德相关（有 Key 才跑，失败不阻断）──
// 高德 Web 服务 Key 相关（需 AMAP_KEY）
if (AMAP_KEY) {
  step('非集团线路（蔡城/木兰/汉奇）', ['scripts/scan-foreign.mjs', '--delay', '1200'], { optional: true })
  step('高德官方轨迹（A 源）', ['scripts/scan-routes-amap.mjs', '--delay', '1100', '--ci-log'], { optional: true })
  step('高德 POI id 回填', ['scripts/scan-amap-ids.mjs'], { optional: true })
} else {
  console.log('\n（跳过高德 Key 步骤：未配置 AMAP_KEY）')
}
// 高德 SSR 补充字段：仅需会话 Cookie，与 Key 互独立（无 Key 也能跑）
if (AMAP_COOKIE) {
  step('高德 SSR 补充字段', ['scripts/scan-poi-newbus.mjs', '--delay', '350'], { optional: true })
} else {
  console.log('\n（跳过高德 SSR 补充字段：未配置 AMAP_WEB_COOKIE）')
}

// ── 7. 资产清单 + 线网底图 ──
step('资产清单 manifest', ['scripts/build-manifest.mjs'])
step('非集团线网底图', ['scripts/build-foreign-net.mjs'])

// ── 8. 交叉验证（官方 vs 高德，输出质量报告）──
step('交叉验证报告', ['scripts/validate-cross.mjs'], { optional: true })

// ── 9. 提交数据到当前分支（main）──
const DATA_PATHS = [
  'src/static/lines.json',
  'src/static/lines',
  'src/static/foreign-lines.json',
  'src/static/network-foreign.json',
  'src/static/lines/manifest.json',
  'reports',
  'scripts/.amap-progress.json',
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
  git(['push', 'origin', `HEAD:refs/heads/${pushBranch}`])
  console.log(`· 数据已提交并推送到分支 ${pushBranch}`)
} else {
  console.log('\n· 数据无变化，跳过提交')
}

// ── 10. 构建 + 部署 Pages ──
if (SKIP_DEPLOY) {
  console.log('\n· SKIP_DEPLOY：跳过构建与部署')
} else {
  // 注意：NPM（npm / npm.cmd）应作为可执行文件直接运行，不能走 step()——
  // step() 会强制用 `node` 作前缀，变成 `node npm run build:h5`，node 会把 npm 当成模块路径去找而报
  // "Cannot find module …/npm"。这里直接 execFileSync(NPM, …)。
  console.log('\n=== 构建 H5 ===')
  try {
    execFileSync(NPM, ['run', 'build:h5'], { cwd: ROOT, stdio: 'inherit' })
  } catch (e) {
    console.error('× 步骤「构建 H5」退出码 ' + (e.status ?? '?'))
    throw e
  }
  console.log('\n=== 部署 Pages ===')
  // 清空 GIT_HTTP_PROXY：Actions runner 无本地代理，让 deploy-pages.mjs 直连推送 pages
  execFileSync('node', ['scripts/deploy-pages.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, GIT_HTTP_PROXY: '' },
  })
}
