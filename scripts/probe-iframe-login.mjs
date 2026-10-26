/**
 * 验证「iframe 内登录高德 → 带登录态请求线路详情」是否可行
 * 做法：在本地页面里注入跨站 iframe，监听 CDP 的 blockedCookies 与最终 cookie 罐
 * 用法：node scripts/probe-iframe-login.mjs [本地页面地址]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9339
const LOCAL = process.argv[2] || 'http://localhost:5174/boundless-whbis/'
const TARGET = 'https://www.amap.com/ssr/search/busline_detail?query_type=TQUERY&query=337%E8%B7%AF&city=420100&busId=900000128833&keywords=337%E8%B7%AF'
const OUT = path.join(os.tmpdir(), 'amap-embed-probe')
const PROFILE = path.join(os.tmpdir(), 'edge-iframe-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
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
const blocked = []
const setCookies = []
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((r) => pending.set(mid, r))
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
  // 事件：被浏览器拦截的第三方 cookie
  if (m.method === 'Network.responseReceivedExtraInfo' && Array.isArray(m.params.blockedCookies)) {
    m.params.blockedCookies.forEach((c) => {
      blocked.push({ name: c.cookieLine.split(';')[0], reasons: c.blockedReasons })
    })
  }
  if (m.method === 'Network.responseReceivedExtraInfo' && Array.isArray(m.params.headers['set-cookie'])) {
    m.params.headers['set-cookie'].forEach((line) => setCookies.push(String(line).slice(0, 90)))
  }
}
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) return { error: r.exceptionDetails.text }
  return r && r.result ? r.result.value : null
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.navigate', { url: LOCAL })
  await sleep(9000)

  // 注入跨站 iframe（等价于页面里 <iframe src="amap busline_detail">）
  const injected = await evaluate(`(async () => {
    const f = document.createElement('iframe');
    f.src = ${JSON.stringify(TARGET)};
    f.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;border:1px solid #888;z-index:99999';
    document.body.appendChild(f);
    await new Promise((r) => setTimeout(r, 8000));
    let inner = null;
    try { inner = f.contentDocument ? 'same-origin(可读)' : 'cross-origin(不可读 DOM)'; } catch (e) { inner = 'cross-origin(抛错)'; }
    return { added: true, inner };
  })()`)
  await sleep(12000)

  const cookies = await send('Network.getAllCookies', { urls: ['https://www.amap.com/', 'https://www.amap.com/ssr/search/busline_detail'] })
  const amapCookies = ((cookies && cookies.cookies) || []).filter((c) => /amap\.com$/.test(c.domain.replace(/^\./, '')))
  const withReasons = await evaluate(`'n/a'`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot && shot.data) fs.writeFileSync(path.join(OUT, 'iframe-login.png'), Buffer.from(shot.data, 'base64'))

  console.log(JSON.stringify({
    iframe: injected,
    blockedCookies: blocked.slice(0, 10),
    blockedCount: blocked.length,
    amapCookieCountInJar: amapCookies.length,
    amapCookiesSample: amapCookies.slice(0, 6).map((c) => `${c.name} sameSite=${c.sameSite || '(unset)'} secure=${c.secure}`),
    setCookieSamples: setCookies.slice(0, 6),
    probe: withReasons,
  }, null, 1))
  ws.close()
  child.kill()
  process.exit(0)
}
