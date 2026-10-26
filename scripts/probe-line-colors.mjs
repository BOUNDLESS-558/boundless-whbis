/**
 * 方向配色体检：打开线路详情页，分别截「上行 / 下行」两张图，并读回线路带与方向徽标的实际渲染色。
 * 用法：node scripts/probe-line-colors.mjs [线路号]
 * 依赖：先 npm run dev:h5，并用 PROBE_BASE 指定地址（默认 http://localhost:5176/boundless-whbis/）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5176/boundless-whbis/'
const OUT = path.join('.openchamber', 'screenshots')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9339
const PROFILE = path.join(process.env.TMP || '.', 'edge-line-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE = `${BASE}#/pages/line/line?lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

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

// 读回线路带 / 站点圆点 / 方向徽标的计算样式，确认 CSS 变量真的落到方向色上
const READ = `(() => {
  const cs = (el, prop) => (el ? (getComputedStyle(el).getPropertyValue(prop) || getComputedStyle(el)[prop] || '') : '');
  const strip = document.querySelector('.route-strip');
  const seg = document.querySelector('.seg');
  const dot = [...document.querySelectorAll('.dot')].find((d) => !d.className.includes('terminal'));
  const term = document.querySelector('.dot.terminal');
  const on = [...document.querySelectorAll('.dir-opt')].find((x) => x.className.includes('active'));
  return {
    stripClass: strip ? strip.className : null,
    vars: strip ? { a: cs(strip, '--line-a'), ring: cs(strip, '--ring') } : null,
    segBg: cs(seg, 'background-image').slice(0, 90),
    dotBorder: cs(dot, 'border-top-color'),
    termFill: cs(term, 'background-color'),
    termRing: cs(term, 'border-top-color'),
    activeTab: on ? on.innerText.trim() : null,
    activeTabBg: cs(on, 'background-image').slice(0, 90),
    nodes: document.querySelectorAll('.node').length,
  };
})()`

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 62 })
  if (s && s.data) {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'))
    console.log('screenshot:', name)
  }
}
async function clickDir(text) {
  await send('Runtime.evaluate', {
    expression: `(() => { const b=[...document.querySelectorAll('.dir-opt')].find(x=>x.innerText.trim().includes('${text}')); if(b){b.click(); return 'ok'} return 'not-found' })()`,
    returnByValue: true,
  })
  await sleep(4500)
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(9000)
  console.log('--- 上行')
  const up = await send('Runtime.evaluate', { expression: READ, returnByValue: true })
  console.log(JSON.stringify(up.result && up.result.value, null, 1))
  await shot(`colors-line-up-${LINE_NO}.jpg`)
  await clickDir('下行')
  console.log('--- 下行')
  const down = await send('Runtime.evaluate', { expression: READ, returnByValue: true })
  console.log(JSON.stringify(down.result && down.result.value, null, 1))
  await shot(`colors-line-down-${LINE_NO}.jpg`)
  ws.close(); child.kill(); process.exit(0)
}
