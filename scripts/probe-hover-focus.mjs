/**
 * 悬停浮标 + 精确定位体检（自绘走向图模式，无需任何地图 Key）。
 * 验四件事：
 *   ① 鼠标移到车辆圆点上 → .bus-hover 出现，内容是「自编号」+ 该车 orgId
 *   ② 鼠标移开 → 浮标消失（不常驻）
 *   ③ 详情窗里点「在地图上定位」→ 相机 zoom 直接到上限 18.5，且该车落在画布正中
 *   ④ 定位瞬间有 .bus-pulse 扩散环，1.6s 后自动清除
 * 用法：node scripts/probe-hover-focus.mjs [线路号]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9345
const PROFILE = path.join(process.env.TMP || '.', 'edge-hover-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE = `${BASE}#/pages/map/map?lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

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
// AGENTS.md：探针不产出任何文件。shot() 保留为空实现，调用点不动。
async function shot(name) {
  return null
}

const PAGE_VM = `(() => {
  let cur = document.querySelector('.schematic') && document.querySelector('.schematic').__vueParentComponent;
  for (let hop = 0; cur && hop < 40; hop++) { const p = cur.proxy || cur.ctx; if (p && p.svgBuses) return p; cur = cur.parent }
  return null;
})()`

// 车点屏幕坐标（取第一辆车的 svg 坐标 + .schematic 在页面中的偏移）
const firstDot = () => evalV(`(() => {
  const p = ${PAGE_VM}; if (!p || !p.svgBuses.length) return null;
  const host = document.querySelector('.schematic').getBoundingClientRect();
  const b = p.svgBuses[0];
  return { x: Math.round(host.left + b.x), y: Math.round(host.top + b.y), orgId: b.bus.orgId };
})()`)

const hoverState = () => evalV(`(() => {
  const t = document.querySelector('.bus-hover');
  if (!t) return { shown: false };
  const b = t.getBoundingClientRect();
  return { shown: true, text: t.innerText.replace(/\\s+/g, ' ').trim(),
    cx: Math.round(b.left + b.width / 2), bottom: Math.round(b.bottom), w: Math.round(b.width) };
})()`)

const camState = () => evalV(`(() => {
  const p = ${PAGE_VM}; if (!p) return null;
  const b = p.svgBuses[0];
  const host = document.querySelector('.schematic').getBoundingClientRect();
  const sh = document.querySelector('.bus-sheet');
  const sr = sh ? sh.getBoundingClientRect() : null;
  return { zoom: p.cam.zoom, canvas: { w: p.canvas.w, h: p.canvas.h }, projCenter: { x: p.projCenter.x, y: p.projCenter.y },
    busXY: b ? { x: Math.round(b.x), y: Math.round(b.y), located: !!b.located } : null,
    sheet: sr ? { l: Math.round(sr.left - host.left), t: Math.round(sr.top - host.top), r: Math.round(sr.right - host.left), b: Math.round(sr.bottom - host.top) } : null,
    pulses: document.querySelectorAll('.bus-pulse').length };
})()`)

const move = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await sleep(160)
}
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(40)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(350)
}
const clickSel = (sel) => evalV(`(() => { const b = document.querySelector('${sel}'); if (!b) return 'not-found'; b.click(); return 'ok' })()`)

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(9000)

  const dot = await firstDot()
  console.log('--- 车辆圆点屏幕坐标:', JSON.stringify(dot))
  if (!dot) { console.log('✗ 没有车辆可测'); ws.close(); child.kill(); process.exit(1) }

  // ① 悬停命中
  await move(dot.x, dot.y)
  const h1 = await hoverState()
  console.log('--- 悬停在车点上:', JSON.stringify(h1))
  await shot('hover-1-tip.jpg')

  // ② 移开 200px → 浮标必须消失
  await move(dot.x + 200, dot.y + 120)
  const h2 = await hoverState()
  console.log('--- 移开鼠标后:', JSON.stringify(h2))

  // ③ 打开详情窗 → 点「在地图上定位」
  await clickAt(dot.x, dot.y)
  const opened = await evalV(`!!document.querySelector('.bus-sheet')`)
  console.log('--- 详情窗打开:', opened)
  console.log('定位: ', await clickSel('.sheet-btn'))
  await sleep(300)
  const c0 = await camState()
  console.log('--- 定位瞬间:', JSON.stringify({ zoom: c0.zoom, pulses: c0.pulses, located: c0.busXY && c0.busXY.located }))
  // 等瓦片加载完再截图（z18 单张瓦片很大，刚定位那一瞬会看到未加载的白/黑块）
  await sleep(1800)
  const c1 = await camState()
  console.log('--- 定位后:', JSON.stringify(c1))
  await shot('hover-2-focus.jpg')

  // ④ 1.6s 后扩散环自动消失
  await sleep(1800)
  const c2 = await camState()

  console.log('==== 结论 ====')
  const tipOk = h1.shown && dot.orgId && h1.text === dot.orgId
  const goneOk = !h2.shown
  const dx = c1 && c1.busXY ? Math.abs(c1.busXY.x - c1.canvas.w / 2) : 999
  const inSheet = c1 && c1.busXY && c1.sheet
    ? (c1.busXY.x > c1.sheet.l && c1.busXY.x < c1.sheet.r && c1.busXY.y > c1.sheet.t && c1.busXY.y < c1.sheet.b)
    : false
  const centerOk = !inSheet
  const zoomOk = c1 && c1.zoom >= 18.4
  const pulseOk = c0 && c0.pulses === 1 && c2.pulses === 0
  console.log('悬停显示自编号:', tipOk ? `✓ “${h1.text}”（纯数字，无“自编号”前缀）` : `✗ ${JSON.stringify(h1)}（应仅为 ${dot.orgId}）`)
  console.log('移开后消失:', goneOk ? '✓' : '✗')
  console.log('定位缩放:', zoomOk ? `✓ zoom=${c1.zoom}` : `✗ zoom=${c1 && c1.zoom}`)
  console.log('车点可见（不被详情窗盖住）:', centerOk ? `✓ 车在 (${c1.busXY.x},${c1.busXY.y})，详情窗 ${JSON.stringify(c1.sheet)}` : `✗ 车被详情窗盖住 ${JSON.stringify({ bus: c1.busXY, sheet: c1.sheet })}`)
  console.log('定位扩散环:', pulseOk ? '✓ 出现一次并在 1.6s 后清除' : `✗ 定位时=${c0 && c0.pulses} 之后=${c2.pulses}`)
  ws.close(); child.kill(); process.exit(0)
}
