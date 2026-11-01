/**
 * 汉奇线路名回归探针（BUG：控制卡把汉奇数字 lineId 当线路号显示，如 00000318038118829 路）
 *   ① 深链进汉奇线路（view=map&source=hanqi&lineId=...&lineName=汉奇K6）→ .dir-cur 必须显示线路名，
 *      不得出现长数字 ID；搜索框回填同样是线路名
 *   ② 汉奇换线（改宿主 lineId + lineName）→ 控制卡跟随新名字（子组件 watch 时序回归的守卫）
 *   ③ whbus 深链（337）仍正常显示 —— 合并 watch 后不能弄坏原路径
 * 只打控制台，不写截图 / 日志（本项目约定：探针不留产物）
 * 用法：node scripts/probe-hanqi-name.mjs [汉奇lineId] [线路名]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const HQ_ID = process.argv[2] || '00000318038118829'
const HQ_NAME = process.argv[3] || '汉奇K6'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9347
const PROFILE = path.join(process.env.TMP || '.', 'edge-hqname-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const HQ_URL = `${BASE}#/pages/map/map?view=map`
const WHB_URL = `${BASE}#/pages/map/map?view=map&lineCode=420100-337-0&direction=0&lineName=337`

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page) { wsUrl = page.webSocketDebuggerUrl; break }
  } catch (e) { /* retry */ }
  await sleep(250)
}
if (!wsUrl) { console.error('CDP 未就绪'); child.kill(); process.exit(1) }

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((r) => pending.set(mid, r))
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const evalV = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description)
  return r && r.result ? r.result.value : null
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '：' + detail : ''}`)
}

// 控制卡线路号徽章 + 搜索框现值（async 轮询等 .dir-cur 出现；必须 awaitPromise）
const READ = `(async () => {
  const get = () => {
    const cur = document.querySelector('.dir-cur');
    const input = document.querySelector('.ctrl .search-row input');
    return {
      cur: cur ? cur.innerText.replace(/\\s+/g, ' ').trim() : null,
      search: input ? input.value : null,
    };
  };
  for (let i = 0; i < 80; i++) { if (get().cur !== null) break; await new Promise((r) => setTimeout(r, 250)); }
  return get();
})()`

const evalA = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description)
  return r && r.result ? r.result.value : null
}

// 汉奇换线：从子组件往上找宿主实例（proxy 响应式），直接调 applyPick 触发真实换线流
const SWITCH = `(async () => {
  let p = document.querySelector('.ctrl').__vueParentComponent;
  while (p && !(typeof p.proxy?.applyPick === 'function' || typeof p.ctx?.applyPick === 'function')) p = p.parent;
  if (!p) return { err: 'no applyPick on ancestors' };
  const target = typeof p.proxy?.applyPick === 'function' ? p.proxy : p.ctx;
  target.applyPick({ source: 'hanqi', lineId: '11111111111111111', lineName: '汉奇TEST', direction: 0 });
  await new Promise((r) => setTimeout(r, 500));
  const cur = document.querySelector('.dir-cur');
  return { cur: cur ? cur.innerText.replace(/\\s+/g, ' ').trim() : null };
})()`

const idle = async (ms) => { await sleep(ms) }

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await seedLogin({ send, BASE, sleep })
  // 预置汉奇线路记忆（onLoad 无汉奇深链参数路径，restore 从 whbis:home-line 恢复）
  await evalA(`(() => uni.setStorageSync('whbis:home-line', ${JSON.stringify({
    lineCode: 'hanqi-' + HQ_ID,
    lineName: HQ_NAME,
    direction: 0,
    startStop: '',
    endStop: '',
    source: 'hanqi',
    lineId: HQ_ID,
  })}))()`)

  console.log('==== ① 汉奇深链进入：' + HQ_NAME + ' (' + HQ_ID + ') ====')
  await send('Page.navigate', { url: HQ_URL })
  const m1 = await evalA(READ)
  check('控制卡显示线路名', !!m1 && m1.cur === HQ_NAME + ' 路', JSON.stringify(m1))
  check('未出现汉奇数字 ID', !!m1 && !/\d{8,}/.test((m1 && m1.cur) || ''), m1 && m1.cur)
  check('搜索框回填线路名', !!m1 && m1.search === HQ_NAME, m1 && m1.search)

  console.log('==== ② 汉奇换线（lineId/lineName 变更）====')
  const m2 = await evalA(SWITCH)
  check('换线后控制卡跟随新名', !!m2 && m2.cur === '汉奇TEST 路', JSON.stringify(m2))
  check('换线后无长数字 ID', !!m2 && !/\d{8,}/.test((m2 && m2.cur) || ''), m2 && m2.cur)

  console.log('==== ③ whbus 深链回归（337）====')
  await send('Page.navigate', { url: 'about:blank' })
  await idle(300)
  await send('Page.navigate', { url: WHB_URL })
  const m3 = await evalA(READ)
  check('337 路正常显示', !!m3 && /337/.test(m3.cur || ''), JSON.stringify(m3))

  console.log(failures ? `\n✗ 未通过 ${failures} 项` : '\n全部通过 ✓')
  ws.close(); child.kill(); process.exit(failures ? 1 : 0)
}
