/**
 * 标签重叠体检：逐个 rect 比对 .stop-label / .bus-label / 车辆圆点，输出重叠对
 * 用法：node scripts/probe-label-overlap.mjs "页面地址" [等待秒数] [--mobile]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9338
const URL_PAGE = process.argv[2]
const WAIT = Number(process.argv[3] || 22)
const MOBILE = process.argv.includes('--mobile')
const PROFILE = path.join(os.tmpdir(), 'edge-overlap-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  await seedLogin({ send, BASE: URL_PAGE.split('#')[0], sleep })
  if (MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(WAIT * 1000)

  const expression = `(() => {
    const rects = (sel) => [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.innerText.trim(), x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
    }).filter((r) => r.text);
    const stops = rects('.stop-label');
    const buses = rects('.bus-label');
    const dots = [...document.querySelectorAll('.schematic svg g > circle[r="6.5"], .schematic svg g > circle[r="9"]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
    });
    const hit = (a, b) => !(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1);
    const pad = (r, p) => ({ ...r, x1: r.x1 - p, y1: r.y1 - p, x2: r.x2 + p, y2: r.y2 + p });
    const out = { stopCount: stops.length, busCount: buses.length, stopVsStop: [], stopVsBus: [], busVsBus: [], stopVsDot: [] };
    const brief = (r) => [r.text, Math.round(r.x1), Math.round(r.y1), Math.round(r.x2), Math.round(r.y2)];
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        if (hit(pad(stops[i], 1), pad(stops[j], 1))) out.stopVsStop.push([brief(stops[i]), brief(stops[j])]);
      }
    }
    stops.forEach((s) => {
      buses.forEach((b) => { if (hit(pad(s, 1), pad(b, 2))) out.stopVsBus.push([brief(s), brief(b)]); });
      dots.forEach((d) => { if (hit(pad(s, 0), pad(d, 2))) out.stopVsDot.push(s.text); });
    });
    for (let i = 0; i < buses.length; i++) {
      for (let j = i + 1; j < buses.length; j++) {
        if (hit(pad(buses[i], 0), pad(buses[j], 0))) out.busVsBus.push([brief(buses[i]), brief(buses[j])]);
      }
    }
    out.stops = stops.map((s) => s.text);
    out.buses = buses.map((b) => b.text);
    return out;
  })()`
  const res = await send('Runtime.evaluate', { expression, returnByValue: true })
  console.log(JSON.stringify(res.result && res.result.value, null, 1))
  // AGENTS.md：探针不产出任何文件——不调 captureScreenshot、不写盘，量测值已在上面打印
  ws.close()
  child.kill()
  process.exit(0)
}
