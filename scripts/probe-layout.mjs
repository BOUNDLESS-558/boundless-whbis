/**
 * 布局体检：打开本地页面，找出横向/纵向溢出元素并截图
 * 用法：node scripts/probe-layout.mjs "http://localhost:5174/boundless-whbis/#/pages/map/map?..." [等待秒数]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9336
const URL_PAGE = process.argv[2]
const WAIT = Number(process.argv[3] || 22)
const OUT = path.join(os.tmpdir(), 'amap-embed-probe')
const PROFILE = path.join(os.tmpdir(), 'edge-layout-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(PROFILE, { recursive: true, force: true })

if (!URL_PAGE) { console.error('请提供页面地址'); process.exit(1) }

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

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(WAIT * 1000)
  const expression = `(() => {
    const vw = innerWidth, vh = innerHeight;
    const bad = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.right > vw + 1 || r.left < -1) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'absolute' || el.tagName === 'SVG' || el.tagName === 'svg') return;
        bad.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
      }
    });
    const texts = [...document.querySelectorAll('.stop-label, .bus-label')].slice(0, 4).map(el => ({
      text: el.innerText, left: el.style.left, top: el.style.top, rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })(),
    }));
    return {
      vw, vh,
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      bodyScrollW: document.body.scrollWidth,
      labels: document.querySelectorAll('.stop-label').length,
      busLabels: document.querySelectorAll('.bus-label').length,
      sample: texts,
      overflow: bad.slice(0, 12),
    };
  })()`
  const res = await send('Runtime.evaluate', { expression, returnByValue: true })
  console.log(JSON.stringify(res.result && res.result.value, null, 1))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot && shot.data) {
    const file = path.join(OUT, 'layout-shot.png')
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log('screenshot:', file)
  }
  ws.close()
  child.kill()
  process.exit(0)
}
