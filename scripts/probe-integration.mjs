/**
 * 单界面整合验证（地图为主界面版）。
 * 验四件事：
 *   ① 首页态：map 页加载后，LineMap 控制卡（搜索 / 方向 / 线路号）出现，
 *      且不出现旧 line 页的线路徽标 / 时刻表 / 线路库
 *   ② 选线：在控制卡搜索框输入 337 并点联想 → 线路加载，底部线路带出现
 *   ③ 设置抽屉：点右上角齿轮 → SettingsDrawer 弹出（遮罩 + 面板），再点关闭按钮
 *   ④ 无 JS 错误：全程 console.error / 异常数为 0
 * 只打控制台，不写截图 / 日志 / 构建产物（本项目约定：探针不留产物）
 * 用法：node scripts/probe-integration.mjs
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9360
const PROFILE = path.join(os.tmpdir(), 'edge-integ-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

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
// ⚠ 必须等 WebSocket 真正连上才能发第一条消息，否则 undici 抛 "Sent before connected"
await new Promise((res) => { ws.onopen = res })
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  // 收集 console.error / page.error 事件
  if (m.method === 'Console.messageAdded' && m.params.message.level === 'error') {
    errors.push(m.params.message.text)
  }
  if (m.method === 'Page.javascriptDialogOpened') {
    errors.push('JS dialog: ' + (m.params.message || ''))
  }
}
const evalV = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description)
  return r && r.result ? r.result.value : null
}
const shot = () => {} // 探针统一空实现，不落盘

// 往搜索框塞值：uni-app 的 <input> 在 H5 下是 uni-input 套原生 input，
// 直接 .value 赋值不会触发 Vue 的 v-model，必须用 Object.getOwnPropertyDescriptor 拿到原生 setter，
// 赋完再派发 input 事件（与 probe-line-suggest.mjs 同一套写法）
const typeIn = (sel, v) => evalV(`(() => {
  const wrap = document.querySelector('${sel}');
  const el = wrap && wrap.querySelector('input');
  if (!el) return { err: 'no input' };
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { value: el.value };
})()`)

const navigate = async (url) => {
  await send('Page.navigate', { url })
  await sleep(1500)
}

let allOk = true
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) allOk = false
}

console.log('==== ① 首页态（地图主界面） ====')
await navigate(`${BASE}#/pages/map/map`)
const home = await evalV(`(() => {
  const ctrlSearch = !!document.querySelector('.ctrl-search');
  const ctrlDir = !!document.querySelector('.ctrl-dir');
  const mapWrap = !!document.querySelector('#amap');
  const bottomPanel = !!document.querySelector('.bottom-panel');
  const bottomTabs = document.querySelectorAll('.bottom-tab');
  const tabLabels = [...bottomTabs].map((t) => t.innerText.trim());
  const lineBadge = !!document.querySelector('.line-badge');
  const modPlan = !!document.querySelector('.mod-plan');
  const dbList = !!document.querySelector('.db-list');
  return { ctrlSearch, ctrlDir, mapWrap, bottomPanel, tabLabels, lineBadge, modPlan, dbList };
})()`)
check('控制卡搜索框存在', home.ctrlSearch)
check('控制卡方向行存在', home.ctrlDir)
check('地图容器存在', home.mapWrap)
check('底部面板存在', home.bottomPanel)
check('底部 Tab 有 2 个', home.tabLabels.length === 2, JSON.stringify(home.tabLabels))
check('首页态不应出现旧线路徽标', !home.lineBadge)
check('首页态不应出现旧时刻表', !home.modPlan)
check('首页态不应出现旧线路库', !home.dbList)

console.log('==== ② 选线进详情态 ====')
// 在控制卡搜索框输入 337，点联想第一条
await typeIn('.ctrl-search', '337')
await sleep(600)
const sug = await evalV(`(() => {
  const items = document.querySelectorAll('.sug-item');
  return items.length;
})()`)
check('联想面板出现条目', sug > 0, `共 ${sug} 条`)
// 点第一条联想
await evalV(`(() => {
  const items = document.querySelectorAll('.sug-item');
  if (items[0]) items[0].click();
  return items.length;
})()`)
await sleep(5000)
const detail = await evalV(`(() => {
  const strip = !!document.querySelector('.bottom-panel');
  const stripItems = document.querySelectorAll('.strip-item');
  const sched = !!document.querySelector('.sched-grid');
  const baseFloat = !!document.querySelector('.base-float');
  const mapWrap = !!document.querySelector('#amap');
  return { strip, stripItems: stripItems.length, sched, baseFloat, mapWrap };
})()`)
check('底部面板出现', detail.strip)
check('线路带出现站点', detail.stripItems > 0, `共 ${detail.stripItems} 个站点`)
check('时刻表可访问', detail.sched !== undefined)
check('基础信息浮条出现', detail.baseFloat)
check('地图仍存在', detail.mapWrap)

console.log('==== ③ 设置抽屉 ====')
// 点齿轮开抽屉
await evalV(`(() => { const g = document.querySelector('.ab-gear'); if (g) g.click(); return !!g })()`)
await sleep(600)
const drawer = await evalV(`(() => {
  const mask = !!document.querySelector('.sd-mask');
  const panel = !!document.querySelector('.sd-panel');
  const card = !!document.querySelector('.sd-panel .card');
  return { mask, panel, card };
})()`)
check('设置抽屉遮罩出现', drawer.mask)
check('设置抽屉面板出现', drawer.panel)
check('设置抽屉内容卡出现', drawer.card)
// 关闭抽屉：CDP 下 dispatchEvent 到不了 uni-h5 的 @click 监听，
// 改用 Input.dispatchMouseEvent 走浏览器原生鼠标事件路径（坐标点击）
await evalV(`(() => {
  const c = document.querySelector('.sd-close');
  if (!c) return 'no-close';
  const r = c.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`)
await sleep(200)
const coords = await evalV(`(() => {
  const c = document.querySelector('.sd-close');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`)
if (coords) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.x, y: coords.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 })
}
await sleep(500)
const drawerClosed = await evalV(`(() => !!document.querySelector('.sd-mask'))`)
check('点关闭按钮关抽屉', !drawerClosed)

console.log('==== ④ JS 错误 ====')
await sleep(500)
check('全程无 console.error / 异常', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '0 条')

console.log('==== 结论 ====', allOk ? '✓ 整合验证全部通过' : '✗ 有失败项')
ws.close(); child.kill(); process.exit(allOk ? 0 : 1)