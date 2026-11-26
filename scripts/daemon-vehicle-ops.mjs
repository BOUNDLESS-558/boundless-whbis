/**
 * 车辆营运信息常驻采集守护进程（不依赖 GitHub Actions）
 *
 * 循环：每 45 秒（OPS_INTERVAL_MS 可配）跑一轮 scripts/scan-vehicle-ops.mjs，
 * 采集结果由该脚本通过 /api/vehicle-ops POST 直接写入 Neon 数据表
 * （vehicle_ops 累计表 + vehicle_ops_daily 按日表），同时保留静态快照落盘。
 *
 * 运行前提：一台**常驻在线、能访问外网**的机器（VPS / NAS / 旧手机 Termux / 家用小主机）。
 *   npm run daemon:ops
 * 必须配置（写库通道，与 Vercel 环境变量同名同值）：
 *   VEHICLE_OPS_API   = https://boundless-whbis.vercel.app/api/vehicle-ops
 *   VEHICLE_OPS_TOKEN = 与 Vercel Settings → Environment Variables 中同名的那个值
 * 可选：
 *   OPS_INTERVAL_MS   默认 45000（45 秒）
 *   OPS_CONCURRENCY   默认 16（保守并发，降低上游限流风险；Actions 默认为 6）
 *   OPS_DELAY         见 scan-vehicle-ops.mjs（请求间限速）
 *   SCAN_BASE         上游反代，脚本内已有默认值
 *
 * 若某一轮耗时超过 45 秒，本轮结束后立即开下一轮，不叠加并发（不会把上游打爆）。
 * Ctrl+C / SIGTERM 会在本轮结束后退出。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'scan-vehicle-ops.mjs')
const INTERVAL = Math.max(5000, Number(process.env.OPS_INTERVAL_MS || 45000))
const CONCURRENCY = Math.max(1, Number(process.env.OPS_CONCURRENCY || 16))

let stopping = false
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args)

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    log(`收到 ${sig}，本轮结束后退出`)
  })
}

function runOnce() {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, OPS_CONCURRENCY: String(CONCURRENCY) },
      stdio: 'inherit',
    })
    child.on('close', (code) => {
      log(`本轮结束 code=${code} 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      resolve(code)
    })
    child.on('error', (e) => {
      log('启动采集脚本失败：' + (e && e.message || e))
      resolve(-1)
    })
  })
}

async function main() {
  log('===== 车辆营运采集守护进程启动 =====')
  log(`间隔 ${INTERVAL}ms · 并发 ${CONCURRENCY} · 脚本 ${path.relative(ROOT, SCRIPT)}`)
  if (!process.env.VEHICLE_OPS_API || !process.env.VEHICLE_OPS_TOKEN) {
    log('⚠ 未配置 VEHICLE_OPS_API / VEHICLE_OPS_TOKEN：本轮只会落静态文件，不会写数据库')
  }
  let n = 0
  while (!stopping) {
    n++
    const t0 = Date.now()
    log(`──── 第 ${n} 轮开始 ────`)
    await runOnce()
    if (stopping) break
    const wait = Math.max(0, INTERVAL - (Date.now() - t0))
    if (wait > 0) {
      log(`等待 ${(wait / 1000).toFixed(1)}s 到下一轮`)
      await new Promise((r) => setTimeout(r, wait))
    } else {
      log('本轮已超过间隔，直接进入下一轮（不叠加并发）')
    }
  }
  log('===== 守护进程已退出 =====')
}

main().catch((e) => {
  log('致命错误：' + (e && e.stack || e))
  process.exit(1)
})
