/**
 * 把 src/utils/routeClean.js 的源码以 ESM 模块载入 Node。
 *
 * 项目 package.json 没有 "type": "module"，Node 会把 src/utils/*.js 当 CJS 解析，
 * 直接 import 会报 "Cannot use import statement outside a module"。
 * routeClean.js 是零依赖纯 ESM，所以用 data: URL 载入同一份源码 —— 离线生成器与
 * 运行时共用唯一真源，不复制第二套算法（改清洗规则只改一个文件）。
 */
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/utils/routeClean.js', import.meta.url), 'utf8')
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
export default mod
