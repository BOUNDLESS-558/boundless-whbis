/**
 * 刷新控件体检：地图页右侧面板的「↻ + 间隔下拉（手动 / 15 / 20 / 30 秒）」。
 * 验证 ① 按钮与下拉的实际渲染 ② 选中后按钮文案与本地存储 ③ 自动刷新真的在按间隔发请求。
 * 用法：node scripts/probe-refresh.mjs [线路号]
 * 依赖：先 npm run dev:h5，并用 PROBE_BASE 指定地址（默认 http://localhost:5173/boundless-whbis/）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const MOBILE = process.env.PROBE_MOBILE === '1'
// QUICK=1 跳过两段 24s 的自动刷新观察，只看渲染（手机布局用）
const QUICK = process.env.PROBE_QUICK === '1'
const TAG = MOBILE ? 'm' : 'd'
const OUT = path.join('.openchamber', 'screenshots')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9341
const PROFILE = path.join(process.env.TMP || '.', 'edge-refresh-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
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
// 实时接口请求计数：按 URL 归类，用于判断自动刷新是否真在跑
const hits = []
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((r) => pending.set(mid, r))
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') {
    const u = (m.params && m.params.request && m.params.request.url) || ''
    if (/realTime|detailData|wechat\/bus/i.test(u)) hits.push({ t: Date.now(), url: u.slice(0, 90) })
  }
}

const READ = `(() => {
  const pill = document.querySelector('.refresh-pill');
  const txt = document.querySelector('.rp-txt');
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const items = [...document.querySelectorAll('.rm-item')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim());
  const on = document.querySelector('.rm-item.on');
  const cs = (el, p) => (el ? (getComputedStyle(el).getPropertyValue(p) || getComputedStyle(el)[p] || '') : '');
  return {
    pillClass: pill ? pill.className : null,
    pillText: txt ? txt.innerText.trim() : null,
    pillBg: cs(pill, 'background-image').slice(0, 70),
    menuOpen: !!document.querySelector('.refresh-menu'),
    menuItems: items,
    menuActive: on ? on.innerText.replace(/\\s+/g, ' ').trim() : null,
    stored: (() => { try { return JSON.parse(JSON.stringify(localStorage)).whbis_map_refresh_sec || localStorage['whbis:map-refresh-sec'] || null } catch (e) { return null } })(),
    mask: !!document.querySelector('.rm-mask'),
    // 面板：方向徽标文字 / 刷新行文案（确认“刷新”文字已移除）/ 常驻车号标签数
    badges: [...document.querySelectorAll('.bus-dir')].map((n) => n.innerText.trim()),
    toolsText: (() => { const t = document.querySelector('.panel-tools'); return t ? t.innerText.replace(/\s+/g, ' ').trim() : null })(),
    busLabels: [...document.querySelectorAll('.bus-label')].filter((n) => n.offsetParent !== null).length,
    sheet: !!document.querySelector('.bus-sheet'),
    viewport: [innerWidth, innerHeight],
    rects: { panel: rect('.panel'), title: rect('.panel-title'), pill: rect('.refresh-pill'), menu: rect('.refresh-menu') },
  };
})()`

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
  if (s && s.data) {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'))
    console.log('screenshot:', name)
  }
}
const clickSel = (sel) => send('Runtime.evaluate', {
  expression: `(() => { const b=document.querySelector('${sel}'); if(b){b.click(); return 'ok'} return 'not-found' })()`,
  returnByValue: true,
})
const clickItem = (label) => send('Runtime.evaluate', {
  expression: `(() => { const b=[...document.querySelectorAll('.rm-item')].find(x=>x.innerText.includes('${label}')); if(b){b.click(); return 'ok'} return 'not-found' })()`,
  returnByValue: true,
})
const read = async (tag) => {
  const r = await send('Runtime.evaluate', { expression: READ, returnByValue: true })
  console.log(`--- ${tag}`)
  console.log(JSON.stringify(r.result && r.result.value, null, 1))
  return r.result && r.result.value
}

// 原生地图标记：确认车辆 marker 上已无 callout（不再常驻气泡遮挡）
const readMarkers = async () => {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      try {
        let cur = document.querySelector('.schematic') && document.querySelector('.schematic').__vueParentComponent;
        for (let hop = 0; cur && hop < 40; hop++) {
          const p = cur.proxy || cur.ctx;
          if (p && p.busesByDir && p.markers) {
            const ms = p.markers;
            const bus = ms.filter((m) => m.id >= 20000);
            return { total: ms.length, bus: bus.length, withCallout: bus.filter((m) => m.callout).length,
              sample: bus.slice(0, 2).map((m) => Object.keys(m).join(',')) };
          }
          cur = cur.parent;
        }
        return 'no-page-vm';
      } catch (e) { return 'ERR: ' + (e && e.message) }
    })()`,
    returnByValue: true,
  })
  console.log('--- 原生地图车辆标记（callout 应全部为 0）')
  console.log(JSON.stringify(r.result && r.result.value, null, 1))
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(9000)
  await read('初始（应为手动）')
  await readMarkers()
  await shot(`refresh-${TAG}-1-manual.jpg`)

  await clickSel('.rp-mode')
  await sleep(400)
  await read('下拉展开')
  await shot(`refresh-${TAG}-2-menu.jpg`)

  // 选 20 秒：应立刻拉一次，之后每 20 秒一次
  await clickItem('20 秒')
  await sleep(1200)
  const after = await read('选中 20 秒后')
  await shot(`refresh-${TAG}-3-20s.jpg`)

  const t0 = Date.now()
  hits.length = 0
  await sleep(QUICK ? 1500 : 24000)
  const auto = hits.length
  console.log(`--- 20 秒模式 24s 内的实时接口请求数: ${auto}`)
  console.log('   时间线(秒):', hits.map((h) => ((h.t - t0) / 1000).toFixed(1)).join(', '),
    '| 每条:', hits.map((h) => h.url.split('?')[0].split('/').pop()).join(', '))

  // 切回手动：之后 24s 不应再有自动请求
  await clickSel('.rp-mode')
  await sleep(400)
  await clickItem('手动刷新')
  await sleep(1500)
  const manual = await read('切回手动后')
  await shot(`refresh-${TAG}-4-back-manual.jpg`)
  hits.length = 0
  await sleep(QUICK ? 1000 : 24000)
  console.log(`--- 手动模式 24s 内的实时接口请求数: ${hits.length}`)

  // 主动单击车辆（列表项）：应弹出底部详情卡，并在示意图上显示该车车号
  await send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('.bus-item'); if (b) { b.click(); return 'ok' } return 'not-found' })()`,
    returnByValue: true,
  })
  await sleep(800)
  await read('单击车辆后（应出现详情卡 + 1 个车号标签）')
  await shot(`refresh-${TAG}-5-selected.jpg`)

  console.log('==== 结论 ====')
  console.log('菜单项:', after.menuItems.length ? '' : '（关闭后无）', '| 20s 期间自动请求:', auto, '| 手动期间:', hits.length)
  ws.close(); child.kill(); process.exit(0)
}
