/**
 * GitHub Pages 一键部署：把 dist/build/h5 打成「无历史孤立提交」强推到远端 pages 分支
 *
 * 用法：
 *   npm run deploy:pages            # 构建 + 部署 + 推送
 *   node scripts/deploy-pages.mjs   # 只部署已构建产物（跳过构建）
 *   node scripts/deploy-pages.mjs --no-push  # 只建本地 pages 分支，不推送
 *
 * 分支模型（2026-10-22 整理）：
 *   main  —— 源码主干（origin/main），GitHub 仓库首页展示的就是它
 *   pages —— 仅存放 H5 构建产物（origin/pages），GitHub Pages 从该分支根目录发布
 *
 * 远端仓库只保留 H5 部署产物（不含源码历史），因此这里不用普通 commit，
 * 而是用 git 底层命令（临时 index + GIT_WORK_TREE）在本地分支 pages 上生成
 * 一个仅含产物文件的孤立提交，再 push -f pages:pages。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist', 'build', 'h5')
// 每次用系统临时目录里的全新唯一目录：不需要先删旧目录，也不会把上一轮残留
// 文件混进提交。收尾清理失败（例如 IDE 的 safe-delete 插件拦截 fs.rm）只警告，
// 绝不阻断后面的强推——推送才是本脚本的目的。
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'whbis-pages-'))
const TMP_INDEX = path.join(ROOT, '.git', 'pages-tmp-index')

/** 尽力删除；失败只警告（清理是收尾动作，不该让部署失败） */
function safeRemove(target, recursive = false) {
  try {
    fs.rmSync(target, { recursive, force: true })
  } catch (e) {
    console.log(`· 清理 ${path.basename(target)} 失败（不影响部署）：${e.message}`)
  }
}
const BRANCH = 'pages'
const REMOTE = 'origin'
// 远端同样叫 pages：产物只落在 pages 分支，绝不覆盖 origin/main（源码主干）
const REMOTE_BRANCH = 'pages'
const noPush = process.argv.includes('--no-push')

function git(args, opts = {}) {
  // 注意：stdio: 'inherit' 时 stdout 不被捕获，execFileSync 返回 null，不能直接 .trim()
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts })
  return (out || '').trim()
}

// 1. 校验产物
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('× 未找到构建产物 dist/build/h5/index.html，请先执行 npm run build:h5')
  process.exit(1)
}

// 2. 暂存区 = 产物 + .nojekyll（禁用 Jekyll，否则 assets/_*.js 会被 Pages 忽略返回 404）
fs.cpSync(DIST, STAGE, { recursive: true })
fs.writeFileSync(path.join(STAGE, '.nojekyll'), '')
const fileCount = (() => {
  let n = 0
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => e.isDirectory() ? walk(path.join(d, e.name)) : n++)
  walk(STAGE)
  return n
})()
console.log(`· 暂存 ${fileCount} 个文件（含 .nojekyll）`)

// 3. 临时 index 生成孤立提交 → 更新本地 pages 分支
safeRemove(TMP_INDEX)
// GIT_DIR 必须显式给出：`git add` 的 cwd 是系统临时目录（不在仓库内），
// 不指定就报 "fatal: not a git repository"。
const env = {
  ...process.env,
  GIT_DIR: path.join(ROOT, '.git'),
  GIT_INDEX_FILE: TMP_INDEX,
  GIT_WORK_TREE: STAGE,
}
git(['read-tree', '--empty'], { env })
git(['add', '-A', '.'], { env, cwd: STAGE })
const tree = git(['write-tree'], { env })
const msg = `deploy: H5 构建产物 @ ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`
const commit = git(['commit-tree', tree, '-m', msg], { env })
git(['update-ref', `refs/heads/${BRANCH}`, commit])
safeRemove(TMP_INDEX)
safeRemove(STAGE, true)
console.log(`· 本地 ${BRANCH} 分支 → ${commit.slice(0, 7)}（孤立，无历史）`)

// 4. 强推远端
// HTTP/1.1：规避本机网络对 H2 上传连接的不稳定；
// 代理优先 + 直连回退：国内直连 github:443 常超时，优先走本地代理；
// 代理不可用时自动降级直连，保障部署可用性。
// 修改代理地址/关闭代理：设置环境变量 GIT_HTTP_PROXY，留空表示只走直连。
const PROXY = process.env.GIT_HTTP_PROXY ?? 'http://127.0.0.1:7890'
// `-c` 必须放在子命令（push）前面，否则 git 会当成 push 的未知选项报 unknown switch
const pushBaseArgs = [
  '-c', 'http.version=HTTP/1.1',
  '-c', 'http.lowSpeedLimit=0',
  '-c', 'http.lowSpeedTime=0',
  'push', '-f', REMOTE, `${BRANCH}:${REMOTE_BRANCH}`
]

if (noPush) {
  console.log(`· --no-push：跳过推送。稍后可执行 git ${pushBaseArgs.join(' ')} `)
} else {
  // 尝试代理推送
  let success = false
  if (PROXY) {
    try {
      console.log(`· 尝试通过代理推送 → ${PROXY}`)
      git(['-c', `http.proxy=${PROXY}`, '-c', `https.proxy=${PROXY}`, ...pushBaseArgs], { stdio: 'inherit' })
      success = true
    } catch (e) {
      console.error(`× 代理推送失败：${e.message}`)
    }
  }
  // 代理失败或未配置时，回退直连
  if (!success) {
    try {
      console.log('· 代理不可用，降级为直连推送')
      git(pushBaseArgs, { stdio: 'inherit' })
      success = true
    } catch (e) {
      console.error(`× 直连推送也失败：${e.message}`)
      process.exit(1)
    }
  }
  console.log(`√ 已强推 ${BRANCH} → ${REMOTE}/${REMOTE_BRANCH}，Pages 将自动重新发布`)
}
