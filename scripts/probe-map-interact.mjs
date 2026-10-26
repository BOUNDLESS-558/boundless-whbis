/**
 * 交互验证：缩放按钮 / 拖拽 / 车辆点击弹层 + 手机尺寸布局
 * 用法：node scripts/probe-map-interact.mjs [页面地址]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9337
const URL_PAGE = process.argv[2] || 'http://localhost:5174/boundless-whbis/#/pages/map/map?lineCode=420100-337-0&direction=0&lineName=337'
const PROFILE = path.join(os.tmpdir(), 'edge-interact-prof')
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) return { error: r.exceptionDetails.text }
  return r && r.result ? r.result.value : null
}
// AGENTS.md：探针不产出任何文件。shot() 保留为空实现，调用点不动。
const shot = async (name) => {
  return null
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(20000)

  const before = await evaluate(`(() => {
    const l = document.querySelector('.stop-label');
    return { left: l && l.style.left, count: document.querySelectorAll('.stop-label').length };
  })()`)

  // 点击两次放大
  await evaluate(`(() => { const b = document.querySelectorAll('.tool-btn.sm')[0]; b && b.click(); b && b.click(); return true })()`)
  await sleep(600)
  const afterZoom = await evaluate(`(() => {
    const l = document.querySelector('.stop-label');
    return { left: l && l.style.left, count: document.querySelectorAll('.stop-label').length };
  })()`)

  // 点击列表第一辆车 → 详情弹层
  await evaluate(`(() => { const b = document.querySelector('.bus-item'); b && b.click(); return true })()`)
  await sleep(500)
  const sheet = await evaluate(`(() => {
    const s = document.querySelector('.bus-sheet');
    return { open: !!s, text: s ? s.innerText.replace(/\\s+/g, ' ').slice(0, 120) : '' };
  })()`)
  await shot('interact-sheet.png')

  // 关闭弹层，滚轮缩放
  await evaluate(`(() => { const b = document.querySelector('.bus-sheet .sheet-btn.primary'); b && b.click(); return true })()`)
  await sleep(300)
  await evaluate(`(() => {
    const el = document.querySelector('.schematic');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -260, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    return true;
  })()`)
  await sleep(600)
  const afterWheel = await evaluate(`(() => {
    const l = document.querySelector('.stop-label');
    return { left: l && l.style.left, count: document.querySelectorAll('.stop-label').length, sheetOpen: !!document.querySelector('.bus-sheet') };
  })()`)

  // 拖拽平移：按住中心向右拖 120px，标签应同步右移
  await evaluate(`(() => {
    const el = document.querySelector('.schematic');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 120, clientY: y + 40, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 120, clientY: y + 40, bubbles: true }));
    return true;
  })()`)
  await sleep(600)
  const afterDrag = await evaluate(`(() => {
    const l = document.querySelector('.stop-label');
    return { left: l && l.style.left, top: l && l.style.top };
  })()`)

  console.log('桌面:', JSON.stringify({ before, afterZoom, sheet, afterWheel, afterDrag }, null, 1))

  // 手机尺寸
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.reload', { ignoreCache: true })
  await sleep(20000)
  const mobile = await evaluate(`(() => {
    const sch = document.querySelector('.schematic');
    const r = sch ? sch.getBoundingClientRect() : null;
    return {
      vw: innerWidth, vh: innerHeight,
      sch: r ? [Math.round(r.width), Math.round(r.height)] : null,
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      labels: document.querySelectorAll('.stop-label').length,
      busLabels: document.querySelectorAll('.bus-label').length,
    };
  })()`)
  console.log('手机:', JSON.stringify(mobile, null, 1))
  await shot('interact-mobile.png')

  ws.close()
  child.kill()
  process.exit(0)
}
