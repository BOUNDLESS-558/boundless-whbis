/**
 * 车辆详情浮窗体检：拖动 / 固定 / 关闭。
 * 用 CDP 派发**真实**输入事件（桌面鼠标、手机触摸），验证位置真的跟着走、固定后拖不动、✕ 能关掉。
 * 用法：node scripts/probe-sheet.mjs [线路号]
 *       PROBE_MOBILE=1 node scripts/probe-sheet.mjs 337   # 触摸模式
 * 依赖：先 npm run dev:h5，并用 PROBE_BASE 指定地址（默认 http://localhost:5173/boundless-whbis/）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const MOBILE = process.env.PROBE_MOBILE === '1'
const TAG = MOBILE ? 'm' : 'd'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9342
const PROFILE = path.join(process.env.TMP || '.', 'edge-sheet-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE = `${BASE}#/pages/map/map?lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=' + (MOBILE ? '390,844' : '1440,900'),
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
  return r && r.result ? r.result.value : null
}

const READ = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } };
  const sheet = document.querySelector('.bus-sheet');
  const head = document.querySelector('.sheet-head');
  const pin = document.querySelector('.sheet-pin');
  return {
    sheet: !!sheet,
    cls: sheet ? sheet.className : null,
    rect: r(sheet),
    headRect: r(head),
    inlineStyle: sheet ? (sheet.getAttribute('style') || '') : null,
    rows: [...document.querySelectorAll('.sheet-row')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim()),
    buttons: [...document.querySelectorAll('.sheet-btn')].map((n) => n.innerText.trim()),
    pinBg: pin ? getComputedStyle(pin).backgroundColor : null,
    mask: !!document.querySelector('.sheet-mask'),
    cursor: head ? getComputedStyle(head).cursor : null,
    grip: (() => { const g = document.querySelector('.sheet-grip'); return g ? getComputedStyle(g).fontSize : null })(),
    viewport: [innerWidth, innerHeight],
  };
})()`

// AGENTS.md：探针不产出任何文件。shot() 保留为空实现，调用点不动。
async function shot(name) {
  return null
}
const read = async (tag) => {
  const v = await evalV(READ)
  console.log(`--- ${tag}`)
  console.log(JSON.stringify(v, null, 1))
  return v
}

// 按住标题栏中心拖到 (+dx, +dy)：桌面走鼠标、手机走触摸
async function drag(dx, dy) {
  const h = await evalV(`(() => { const e = document.querySelector('.sheet-head'); if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } })()`)
  if (!h) return 'no-head'
  const N = 6
  if (MOBILE) {
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }]
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(h.x, h.y) })
    for (let i = 1; i <= N; i++) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(h.x + (dx * i) / N, h.y + (dy * i) / N) })
      await sleep(30)
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= N; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x + (dx * i) / N, y: h.y + (dy * i) / N, button: 'left', buttons: 1 })
      await sleep(30)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x + dx, y: h.y + dy, button: 'left', buttons: 0, clickCount: 1 })
  }
  await sleep(350)
  return 'ok'
}

const clickSel = (sel) => evalV(`(() => { const b = document.querySelector('${sel}'); if (b) { b.click(); return 'ok' } return 'not-found' })()`)

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  if (MOBILE) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  }
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(9000)

  // 单击右侧列表里的第一辆车 → 浮窗出现
  await clickSel('.bus-item')
  await sleep(700)
  const opened = await read('单击车辆后（浮窗应出现，且无遮罩）')
  await shot(`sheet-${TAG}-1-open.jpg`)

  // 1) 拖动
  console.log('drag:', await drag(140, 90))
  const moved = await read('拖动 +140,+90 之后（位置应跟着走）')
  await shot(`sheet-${TAG}-2-dragged.jpg`)

  // 2) 固定后再拖：位置不应变化
  console.log('pin:', await clickSel('.sheet-pin'))
  await sleep(400)
  const pinned = await read('点 📌 固定后')
  console.log('drag while pinned:', await drag(-120, -60))
  const afterPinned = await read('固定状态下拖动（位置应不变）')
  await shot(`sheet-${TAG}-3-pinned.jpg`)

  // 3) 解除固定 → 再拖应能动（向上拖，避免落到已被夹住的底边）
  console.log('unpin:', await clickSel('.sheet-pin'))
  await sleep(300)
  console.log('drag after unpin:', await drag(-80, -90))
  const unpinned = await read('解锁后向左上拖 -80,-90（应能动）')

  // 4) 拖到屏幕外：应被夹在视口内
  console.log('drag out of screen:', await drag(2000, 2000))
  const clamped = await read('向右下猛拖（应被夹在视口内）')

  // 5) 关闭
  console.log('close:', await clickSel('.sheet-close'))
  await sleep(400)
  const closed = await read('点 ✕ 关闭后（应无浮窗）')
  await shot(`sheet-${TAG}-4-closed.jpg`)

  console.log('==== 结论 ====')
  const d = (a, b) => (a && b ? `dx=${b.x - a.x} dy=${b.y - a.y}` : 'n/a')
  console.log('初始位置:', JSON.stringify(opened.rect), '| 视口:', JSON.stringify(opened.viewport))
  console.log('拖动后位移:', d(opened.rect, moved.rect), '(期望 ≈ dx=140 dy=90)')
  console.log('固定标记:', pinned.cls, '| 固定后位移:', d(moved.rect, afterPinned.rect), '(期望 dx=0 dy=0)')
  console.log('解锁后位移:', d(afterPinned.rect, unpinned.rect), '(期望 dx≈-80 dy≈-90)')
  console.log('夹取后:', JSON.stringify(clamped.rect), '视口:', JSON.stringify(clamped.viewport))
  console.log('关闭后浮窗:', closed.sheet, '| 遮罩:', closed.mask)
  console.log('底部按钮:', JSON.stringify(closed.buttons || opened.buttons))
  ws.close(); child.kill(); process.exit(0)
}
