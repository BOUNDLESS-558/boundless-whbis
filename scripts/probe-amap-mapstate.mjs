/**
 * 探测 4：读取 amap.com 首页地图的真实 center / zoom，评估「URL 参数 + Web Mercator 投影」叠加对齐可行性
 *
 * 原理：Page.addScriptToEvaluateOnNewDocument 注入钩子，捕获 AMap.Map 实例，
 *       在其 complete 事件后读出 getCenter()/getZoom()。
 *
 * 用法：node scripts/probe-amap-mapstate.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9334
const TARGET = process.argv[2] || 'https://www.amap.com/?center=114.2985,30.5843&zoom=14'
const PROFILE = path.join(os.tmpdir(), 'edge-amap-state-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(PROFILE, { recursive: true, force: true })
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const list = await r.json()
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

const HOOK = `
(() => {
  window.__AMAP_STATE__ = [];
  let _v;
  const hookInstance = (inst) => {
    try {
      const snap = () => {
        try {
          const c = inst.getCenter && inst.getCenter();
          window.__AMAP_STATE__.push({ lng: c && (c.getLng ? c.getLng() : c.lng), lat: c && (c.getLat ? c.getLat() : c.lat), zoom: inst.getZoom && inst.getZoom(), ts: Date.now() });
        } catch (e) {}
      };
      snap();
      inst.on && inst.on('zoomend', snap);
      inst.on && inst.on('moveend', snap);
    } catch (e) {}
  };
  Object.defineProperty(window, 'AMap', {
    configurable: true,
    set(v) {
      Object.defineProperty(window, 'AMap', { value: v, writable: true, configurable: true });
      try {
        if (v && v.Map) {
          const orig = v.Map;
          v.Map = new Proxy(orig, {
            construct(t, args, nt) { const inst = Reflect.construct(t, args, nt); hookInstance(inst); return inst; },
          });
          Object.setPrototypeOf(v.Map, orig);
        }
      } catch (e) {}
    },
    get() { return _v; },
  });
})();
`

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK })
  await send('Page.navigate', { url: TARGET })
  await sleep(20000)
  const res = await send('Runtime.evaluate', {
    expression: `({ url: location.href, hasAMap: typeof window.AMap, state: window.__AMAP_STATE__ || [], canvas: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height), dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight, login: document.body.innerText.includes('短信登录') })`,
    returnByValue: true,
  })
  console.log('TARGET:', TARGET)
  console.log(JSON.stringify(res.result && res.result.value, null, 1))
  ws.close()
  child.kill()
  process.exit(0)
}
