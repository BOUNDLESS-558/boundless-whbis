/**
 * 首页「实时线路」视图的刷新控件体检：那枚「↻ | 15秒 ▾」胶囊，应与地图页 .refresh-pill 视觉一致。
 * 验证 ① 结构渲染（渐变胶囊 / 分隔线 / 间隔文案 / 自动光环）② 下拉四项与选中态
 *      ③ 选中后存储与定时器真的按新间隔发请求 ④ 菜单不溢出视口
 * 只把结论打到控制台，不写截图 / 日志文件（本项目约定：探针不留产物）
 * 用法：node scripts/probe-line-refresh.mjs [线路号]
 * 依赖：先 npm run dev:h5；PROBE_BASE 可指定地址（默认 http://localhost:5173/boundless-whbis/）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const MOBILE = process.env.PROBE_MOBILE === '1'
// QUICK=1 跳过两段等待请求的观察，只看渲染（窄屏布局用）
const QUICK = process.env.PROBE_QUICK === '1'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9347
const PROFILE = path.join(process.env.TMP || '.', 'edge-linerefresh-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 清掉上次的浏览器 profile：localStorage 需要从“从未设过”开始，否则默认值断言不成立
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE =
  `${BASE}#/pages/map/map?view=stops&lineCode=420100-${LINE_NO}-0&direction=0` +
  `&lineName=${encodeURIComponent(LINE_NO + '路')}`

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
// 实时接口请求时间线：判断自动刷新是否真在按新间隔跑
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
    if (/\/detailData/i.test(u)) hits.push({ t: Date.now(), url: u.slice(0, 70) })
  }
}

const READ = `(() => {
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
  const pill = q('.refresh-pill');
  const cs = (el, p) => (el ? (getComputedStyle(el)[p] || '') : '');
  return {
    // 结构：新胶囊应在，旧的「↻ 刷新」按钮必须已消失
    pill: !!pill,
    legacyBtn: !!q('.refresh-btn'),
    pillClass: pill ? pill.className : null,
    pillText: q('.rp-txt') ? q('.rp-txt').innerText.trim() : null,
    pillBg: pill ? cs(pill, 'background-image').slice(0, 60) : null,
    pillShadow: pill ? cs(pill, 'box-shadow').slice(0, 60) : null,
    // 三段结构：↻ / 竖分隔线 / 文案+▾
    ico: q('.rp-ico') ? q('.rp-ico').innerText.trim() : null,
    split: rect('.rp-split'),
    caretOpen: !!q('.rp-caret.open'),
    menuOpen: !!q('.refresh-menu'),
    menuItems: [...document.querySelectorAll('.rm-item')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim()),
    menuOn: q('.rm-item.on') ? q('.rm-item.on').innerText.replace(/\\s+/g, ' ').trim() : null,
    mask: !!q('.rm-mask'),
    stored: (() => {
      const k = 'whbis:line-refresh-sec';
      try {
        const raw = localStorage[k];
        if (raw === undefined || raw === null || raw === '') return null;
        // uni-app H5 把值包成 {"type":"number","data":15}，取 data 才是业务值
        const o = JSON.parse(raw);
        return o && typeof o === 'object' && 'data' in o ? o.data : o;
      } catch (e) { return null }
    })(),
    viewport: [innerWidth, innerHeight],
    rects: { tip: rect('.live-tip'), pill: rect('.refresh-pill'), menu: rect('.refresh-menu'), info: rect('.lt-info') },
  };
})()`

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
ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await seedLogin({ send, evalV, BASE, sleep })
  await send('Network.enable')
  // 换新文档再进目标页：uni-app 是 hash 路由，同文档内改 hash 不会重建页面
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(300)
  await send('Page.navigate', { url: URL_PAGE })
  // 首屏要等接口回来（线路 + 实时），用轮询而不是死等
  let ready = false
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('.mod-ctrl .refresh-pill') && document.querySelectorAll('.node').length > 0`,
      returnByValue: true,
    })
    if (r.result && r.result.value) { ready = true; break }
    await sleep(400)
  }
  await sleep(1200)
  const a = await read(ready ? '① 初始渲染（默认 15 秒自动）' : '① 初始渲染（首屏未就绪）')

  check(a.pill, '胶囊存在')
  check(!a.legacyBtn, '旧的「↻ 刷新」按钮已移除')
  check(!!a.split, '中间竖分隔线存在')
  check(a.pillText === '15秒', '默认间隔显示 15秒', String(a.pillText))
  check(String(a.pillClass || '').includes('auto'), '自动模式有 auto 光环类')
  check(a.ico === '↻', '左半是 ↻ 图标', String(a.ico))
  check(!!a.rects.pill && a.rects.pill.w < 220, '胶囊宽度合理（非整行铺满）', a.rects.pill ? a.rects.pill.w + 'px' : 'null')
  // 与左侧「共 N 站 · M 辆在线」不得重叠
  const overlap = a.rects.info && a.rects.pill && a.rects.info.right > a.rects.pill.x
  check(!overlap, '不与左侧信息文字重叠')

  await clickSel('.rp-mode')
  await sleep(420)
  const b = await read('② 下拉展开')
  check(b.menuItems.length === 4, '下拉四项', b.menuItems.join(' / '))
  check(!!b.menuOn && b.menuOn.includes('15'), '当前项（15 秒）带选中态', String(b.menuOn))
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

  // ④ 切手动：不应再有自动请求
  await clickSel('.rp-mode')
  await sleep(400)
  await clickItem('手动刷新')
  await sleep(1600)
  const d = await read('④ 切到手动刷新')
  check(d.pillText === '手动', '文案变为「手动」', String(d.pillText))
  check(!String(d.pillClass || '').includes('auto'), 'auto 光环已移除')
  check(String(d.stored) === '0', '存储写入 0', String(d.stored))
  hits.length = 0
  await sleep(17000)
  check(hits.length === 0, '手动模式 17s 内无自动请求', hits.length + ' 次')

  // ⑤ 切回 15 秒：立即补一次 + 18s 内再来一次
  await clickSel('.rp-mode')
  await sleep(400)
  await clickItem('15 秒')
  await sleep(1600)
  const e = await read('⑤ 切回 15 秒')
  check(e.pillText === '15秒', '文案回到「15秒」', String(e.pillText))
  check(String(e.pillClass || '').includes('auto'), 'auto 光环恢复')
  check(String(e.stored) === '15', '存储写入 15', String(e.stored))
  hits.length = 0
  const t0 = Date.now()
  await sleep(18000)
  const timeline = hits.map((h) => ((h.t - t0) / 1000).toFixed(1))
  // 每次刷新打两个方向各一次 detailData
  check(hits.length >= 2, '15 秒模式 18s 内有自动请求', timeline.join('s, ') + 's')

  console.log('==== 结论 ====')
  console.log(fails.length ? 'FAIL: ' + fails.join(' , ') : 'ALL PASS')
  ws.close(); child.kill(); process.exit(fails.length ? 1 : 0)
}
