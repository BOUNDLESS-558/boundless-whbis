/**
 * 探测 3：用 CDP 抓 amap.com 线路详情页的网络请求
 * 目的：找出页面加载线路数据所用的内部接口，并确认该接口是否强制登录
 *
 * 用法：node scripts/probe-amap-cdp.mjs [busId]
 * 依赖：本机 Edge (C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe)
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const busId = process.argv[2] || '900000128833'
const URL_PAGE = `https://www.amap.com/ssr/search/busline_detail?query_type=TQUERY&query=337%E8%B7%AF&city=420100&geoobj=114.183559%7C30.498013%7C114.523448%7C30.679478&zoom=12&busId=${busId}&keywords=337%E8%B7%AF&key_name=337%E8%B7%AF`
const PROFILE = path.join(os.tmpdir(), 'edge-amap-cdp-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(PROFILE, { recursive: true, force: true })
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

async function getJson(u) {
  const r = await fetch(u)
  return r.json()
}

let wsUrl = null
for (let i = 0; i < 40; i++) {
  try {
    const list = await getJson(`http://127.0.0.1:${PORT}/json/list`)
    const page = list.find((t) => t.type === 'page')
    if (page) { wsUrl = page.webSocketDebuggerUrl; break }
  } catch (e) { /* not ready */ }
  await sleep(250)
}
if (!wsUrl) { console.error('CDP 未就绪'); child.kill(); process.exit(1) }

const ws = new WebSocket(wsUrl)
let msgId = 0
const pending = new Map()
const reqs = new Map()
const interesting = []

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
  const { method, params } = msg
  if (method === 'Network.requestWillBeSent') {
    const u = params.request.url
    if (!u.includes('amap.com') && !u.includes('autonavi')) return
    if (/\.(js|css|png|jpg|jpeg|gif|woff2?|svg|ico|webp)/.test(u)) return
    if (/g\.alicdn|aplus|tracker|log\./.test(u)) return
    reqs.set(params.requestId, { url: u, method: params.request.method, post: params.request.postData })
  }
  if (method === 'Network.responseReceived' && reqs.has(params.requestId)) {
    const item = reqs.get(params.requestId)
    item.status = params.response.status
    item.mime = params.response.mimeType
    interesting.push(item)
  }
}

ws.onopen = async () => {
  await send('Network.enable')
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(18000)

  // 读取页面文本特征 + 登录弹窗状态
  const evalRes = await send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.title,
      text: document.body.innerText.slice(0, 600),
      hasLoginModal: document.body.innerText.includes('短信登录') || document.body.innerText.includes('扫码登录'),
      hasLine: document.body.innerText.includes('公交停车场'),
      scripts: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.includes('ssr-next') || s.includes('amap.com')).slice(0, 20),
    }))()`,
    returnByValue: true,
  })
  const v = (evalRes && evalRes.result && evalRes.result.value) || {}
  console.log('\n=== 页面状态 ===')
  console.log('title:', v.title)
  console.log('hasLoginModal:', v.hasLoginModal, '| hasLine:', v.hasLine)
  console.log('bodyText:', (v.text || '').replace(/\s+/g, ' ').slice(0, 350))
  console.log('\n=== 数据类请求(amap域名, 非静态) ===')
  interesting.forEach((r) => {
    console.log(`${r.status} ${r.method} ${r.url.slice(0, 180)}`)
    if (r.post) console.log('   post:', String(r.post).slice(0, 200))
  })
  console.log('\n=== 页面 JS chunk(ssr-next) ===')
  ;(v.scripts || []).forEach((s) => console.log('  ' + s))

  ws.close()
  child.kill()
  process.exit(0)
}
