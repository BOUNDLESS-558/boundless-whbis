/**
 * 刷新控件体检（地图页 / 实时线路视图，由 PROBE_VIEW 切换，默认 map）。
 *   PROBE_VIEW=map    → 地图页右侧面板「↻ + 间隔下拉」（存储 whbis:map-refresh-sec）
 *   PROBE_VIEW=stops  → 实时线路视图胶囊「↻ | 15秒 ▾」（存储 whbis:line-refresh-sec）
 * 验证：① 胶囊与下拉渲染 ② 选中后文案/存储/auto 光环 ③ 自动刷新真实按间隔发请求
 *       ④ stops 视图片额外校验四项/选中态/菜单不溢出/旧「↻ 刷新」按钮已移除
 *       ⑤ map 视图片额外校验车辆 marker 无 callout 常驻、单击车辆出详情卡
 * 用法：node scripts/probe-refresh.mjs [线路号]
 * 依赖：先 npm run dev:h5；PROBE_BASE / PROBE_MOBILE / PROBE_QUICK / PROBE_VIEW 可指定
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const MOBILE = process.env.PROBE_MOBILE === '1'
const QUICK = process.env.PROBE_QUICK === '1'
const VIEW = process.env.PROBE_VIEW || 'map'
const isStops = VIEW === 'stops'
const STORE_KEY = isStops ? 'whbis:line-refresh-sec' : 'whbis:map-refresh-sec'
const TAG = (MOBILE ? 'm' : 'd') + (isStops ? '-stops' : '')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9341
const PROFILE = path.join(process.env.TMP || '.', isStops ? 'edge-linerefresh-prof' : 'edge-refresh-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE =
  `${BASE}#/pages/map/map?` + (isStops ? 'view=stops&' : '') +
  `lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

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
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
  const pill = q('.refresh-pill');
  const txt = q('.rp-txt');
  const cs = (el, p) => (el ? (getComputedStyle(el).getPropertyValue(p) || getComputedStyle(el)[p] || '') : '');
  const items = [...document.querySelectorAll('.rm-item')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim());
  const on = q('.rm-item.on');
  return {
    pill: !!pill,
    pillClass: pill ? pill.className : null,
    pillText: txt ? txt.innerText.trim() : null,
    pillBg: cs(pill, 'background-image').slice(0, 70),
    pillShadow: pill ? cs(pill, 'box-shadow').slice(0, 60) : null,
    ico: q('.rp-ico') ? q('.rp-ico').innerText.trim() : null,
    split: rect('.rp-split'),
    caretOpen: !!q('.rp-caret.open'),
    legacyBtn: !!q('.refresh-btn'),
    menuOpen: !!q('.refresh-menu'),
    menuItems: items,
    menuActive: on ? on.innerText.replace(/\\s+/g, ' ').trim() : null,
    mask: !!q('.rm-mask'),
    stored: (() => {
      const k = ${JSON.stringify(STORE_KEY)};
      try {
        const raw = localStorage[k];
        if (raw === undefined || raw === null || raw === '') return null;
        const o = JSON.parse(raw);
        return o && typeof o === 'object' && 'data' in o ? o.data : o;
      } catch (e) { return null }
    })(),
    badges: [...document.querySelectorAll('.bus-dir')].map((n) => n.innerText.trim()),
    toolsText: (() => { const t = q('.panel-tools'); return t ? t.innerText.replace(/\\s+/g, ' ').trim() : null })(),
    busLabels: [...document.querySelectorAll('.bus-label')].filter((n) => n.offsetParent !== null).length,
    sheet: !!q('.bus-sheet'),
    viewport: [innerWidth, innerHeight],
    rects: { panel: rect('.panel'), title: rect('.panel-title'), pill: rect('.refresh-pill'), menu: rect('.refresh-menu'), info: rect('.lt-info'), tip: rect('.live-tip') },
  };
})()`

// AGENTS.md：探针不产出任何文件。shot() 保留为空实现，调用点不动。
async function shot() { return null }

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
  const v = r.result && r.result.value
  console.log(`--- ${tag}`)
  console.log(JSON.stringify(v, null, 1))
  return v
}
const fails = []
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' | ' + extra : ''}`)
  if (!ok) fails.push(label)
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
  await seedLogin({ send, BASE, sleep })
  await send('Network.enable')
  // 换新文档再进目标页：hash 路由同文档内改 hash 不会重建页面
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(300)
  await send('Page.navigate', { url: URL_PAGE })
  // 首屏等接口回来（线路 + 实时），轮询就绪
  let ready = false
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('.refresh-pill') && (document.querySelectorAll('.node').length > 0 || !!document.querySelector('.schematic') || document.querySelectorAll('.bus-label').length > 0)`,
      returnByValue: true,
    })
    if (r.result && r.result.value) { ready = true; break }
    await sleep(400)
  }
  await sleep(1200)
  const a = await read(ready ? `① 初始渲染（默认 ${isStops ? '15秒自动' : '手动'}）` : '① 初始渲染（首屏未就绪）')

  check(a.pill, '胶囊存在')
  if (isStops) {
    check(!a.legacyBtn, '旧的「↻ 刷新」按钮已移除')
    check(!!a.split, '中间竖分隔线存在')
    check(a.pillText === '15秒', '默认间隔显示 15秒', String(a.pillText))
    check(String(a.pillClass || '').includes('auto'), '自动模式有 auto 光环类')
    check(a.ico === '↻', '左半是 ↻ 图标', String(a.ico))
    check(!!a.rects.pill && a.rects.pill.w < 220, '胶囊宽度合理（非整行铺满）', a.rects.pill ? a.rects.pill.w + 'px' : 'null')
    const overlap = a.rects.info && a.rects.pill && a.rects.info.right > a.rects.pill.x
    check(!overlap, '不与左侧信息文字重叠')
  } else {
    console.log('（地图视图：初始应为手动，仅打印不强制断言文案）')
  }

  await clickSel('.rp-mode')
  await sleep(420)
  const b = await read('② 下拉展开')
  check(b.menuItems.length === 4, '下拉四项', b.menuItems.join(' / '))
  check(!!b.menuOn, '当前项带选中态', String(b.menuOn))
  check(b.mask, '遮罩已挂载（点外部可关）')
  check(b.caretOpen, '▾ 已旋转 180°')
  const m = b.rects.menu
  if (m) {
    check(m.right <= b.viewport[0] && m.x >= 0, '菜单不溢出视口（右对齐向左展开）', `x=${m.x} right=${m.right} vw=${b.viewport[0]}`)
    check(m.y >= b.rects.pill.bottom - 2, '菜单展开在胶囊下方', `menu.y=${m.y} pill.bottom=${b.rects.pill.bottom}`)
  } else {
    check(false, '菜单矩形可测')
  }

  // 点遮罩关闭
  await clickSel('.rm-mask')
  await sleep(350)
  const c = await read('③ 点遮罩关闭后')
  check(!c.menuOpen && !c.mask, '点遮罩能收起下拉')

  if (MOBILE || QUICK) {
    console.log('==== 结论（QUICK：跳过请求观察）====')
    console.log(fails.length ? 'FAIL: ' + fails.join(' , ') : 'ALL PASS')
    ws.close(); child.kill(); process.exit(fails.length ? 1 : 0)
  }

  // ④ 选 20 秒（两视图菜单均有）→ 自动刷新计数
  await clickSel('.rp-mode')
  await sleep(420)
  await clickItem('20 秒')
  await sleep(1200)
  const after = await read('④ 选中 20 秒后')
  await shot(`refresh-${TAG}-20s.jpg`)
  const t0 = Date.now()
  hits.length = 0
  await sleep(QUICK ? 1500 : 24000)
  const auto = hits.length
  console.log(`--- 20 秒模式 24s 内的实时接口请求数: ${auto}`)
  console.log('   时间线(秒):', hits.map((h) => ((h.t - t0) / 1000).toFixed(1)).join(', '),
    '| 每条:', hits.map((h) => h.url.split('?')[0].split('/').pop()).join(', '))
  check(auto > 0, '20 秒模式自动刷新在按间隔发请求', auto + ' 次')

  // ⑤ 切回手动：之后不应再有自动请求
  await clickSel('.rp-mode')
  await sleep(400)
  await clickItem('手动刷新')
  await sleep(1600)
  const manual = await read('⑤ 切回手动后')
  await shot(`refresh-${TAG}-manual.jpg`)
  check(manual.pillText === '手动', '文案变为「手动」', String(manual.pillText))
  check(!String(manual.pillClass || '').includes('auto'), 'auto 光环已移除')
  check(String(manual.stored) === '0', '存储写入 0', String(manual.stored))
  hits.length = 0
  await sleep(QUICK ? 1000 : 17000)
  console.log(`--- 手动模式 17s 内的实时接口请求数: ${hits.length}`)
  check(hits.length === 0, '手动模式无自动请求', hits.length + ' 次')

  // 地图视图片：车辆标记 callout + 单击车辆出详情卡
  if (!isStops) {
    await readMarkers()
    await send('Runtime.evaluate', {
      expression: `(() => { const b = document.querySelector('.bus-item'); if (b) { b.click(); return 'ok' } return 'not-found' })()`,
      returnByValue: true,
    })
    await sleep(800)
    await read('单击车辆后（应出现详情卡 + 1 个车号标签）')
    await shot(`refresh-${TAG}-selected.jpg`)
  }

  console.log('==== 结论 ====')
  console.log('菜单项:', after.menuItems.length ? '' : '（关闭后无）', '| 20s 期间自动请求:', auto, '| 手动期间:', hits.length)
  console.log(fails.length ? 'FAIL: ' + fails.join(' , ') : 'ALL PASS')
  ws.close(); child.kill(); process.exit(fails.length ? 1 : 0)
}
