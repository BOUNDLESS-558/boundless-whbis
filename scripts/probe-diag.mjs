/**
 * 诊断：dump line 页渲染出的 HTML 与控制台错误
 * 用法：node scripts/probe-diag.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9361
const PROFILE = path.join(os.tmpdir(), 'edge-diag-prof')
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
await new Promise((res) => { ws.onopen = res })
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const a = m.params.args && m.params.args[0]
    errors.push((a && a.value) || JSON.stringify(m.params.args))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('EXC: ' + (m.params.exceptionDetails ? m.params.exceptionDetails.text : ''))
  }
}
const evalV = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r && r.result ? r.result.value : null
}

await send('Runtime.enable', {})
await send('Page.navigate', { url: `${BASE}#/pages/line/line` })
await sleep(2500)

const html = await evalV('(() => document.documentElement.outerHTML.slice(0, 1500))()')
console.log('=== HTML 前 1500 字符 ===')
console.log(html)

console.log('=== 控台错误 ===')
console.log(errors.length ? errors.join('\n') : '（无）')

const cls = await evalV('(() => [...document.querySelectorAll("*")].map(e=>e.className).filter(c=>typeof c==="string"&&c).join("|").slice(0,600))()')
console.log('=== 出现的 class（前 600） ===')
console.log(cls)

ws.close(); child.kill()