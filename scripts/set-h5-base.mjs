/**
 * 按部署目标切换 manifest.json 的 h5.router.base：
 *   - Vercel / 根域部署：base = "/"
 *   - GitHub Pages 项目子路径：base = "/boundless-whbis/"
 *
 * 用法：node scripts/set-h5-base.mjs /             （根域）
 *       node scripts/set-h5-base.mjs /boundless-whbis/  （子路径，默认恢复）
 *
 * 直接文本替换，保留 manifest.json 里的注释（uni-app 的 manifest 带 JSONC 注释，不能 JSON.parse）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '../src/manifest.json')
const target = (process.argv[2] || '/boundless-whbis/').trim()

const src = fs.readFileSync(FILE, 'utf8')
const out = src.replace(/("base"\s*:\s*)"[^"]*"/, `$1"${target}"`)
if (out === src) {
  console.log(`base 已是 ${target} 或替换失败，未改动`)
} else {
  fs.writeFileSync(FILE, out, 'utf8')
  console.log(`√ h5.router.base → ${target}`)
}
