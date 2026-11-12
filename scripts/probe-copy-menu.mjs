/**
 * 复制胶囊 + 全站下拉互斥体检：
 *   ① 五处复制入口统一为「左键执行 + 右键档位下拉（纯文本 / Excel / 图片）」，
 *      档位在任意一处切换后其余胶囊（含跨视图）即时同步，菜单恒垂直向下且与档位键右对齐；
 *   ② 复制 / 刷新间隔 / 搜索联想三类就地菜单同屏只留一个，点空白处统一收起。
 * 用法：node scripts/probe-copy-menu.mjs [线路号]
 * 依赖：先 npm run dev:h5；PROBE_BASE 可指定端口
 * 不落盘、不截图，结论只在控制台
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9347
const PROFILE = path.join(process.env.TMP || '.', 'edge-copymenu-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const MAP_URL = `${BASE}#/pages/map/map?lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

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

const evalV = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text }
  return r && r.result ? r.result.value : null
}

const READ = `(() => {
  const pills = [...document.querySelectorAll('.copy-pill')];
  const txt = (n) => (n ? n.innerText.replace(/\\s+/g, ' ').trim() : null);
  const m = document.querySelector('.cp-menu');
  const mb = m ? m.getBoundingClientRect() : null;
  return {
    hash: location.hash.slice(0, 60),
    minTools: !!document.querySelector('.min-tools'),
    wins: [...document.querySelectorAll('.float-win .fw-title')].map((n) => n.innerText.trim()),
    minStore: uni.getStorageSync('whbis:min-stops-mode'),
    minHead: !!document.querySelector('.min-head-top'),
    parents: pills.map((p) => (p.parentElement ? p.parentElement.className : null)),
    count: pills.length,
    pills: pills.map((p) => {
      const b = p.getBoundingClientRect();
      return { main: txt(p.querySelector('.cp-main')), mode: txt(p.querySelector('.cp-mode-txt')), h: Math.round(b.height) };
    }),
    menuOpen: !!m,
    menu: [...document.querySelectorAll('.cp-opt')].map(txt),
    menuOn: txt(document.querySelector('.cp-opt.on')),
    menuRect: mb ? {
      w: Math.round(mb.width), h: Math.round(mb.height),
      inView: mb.top >= 0 && mb.left >= 0 && mb.right <= innerWidth + 0.5 && mb.bottom <= innerHeight + 0.5,
    } : null,
    menuDir: (() => {
      const m = document.querySelector('.cp-menu');
      const a = document.querySelector('.copy-pill.menu-open .cp-mode');
      if (!m || !a) return null;
      const mb = m.getBoundingClientRect(), ab = a.getBoundingClientRect();
      return { menuTop: Math.round(mb.top), anchorBottom: Math.round(ab.bottom),
               down: mb.top >= ab.bottom - 1, gap: Math.round(mb.top - ab.bottom),
               rightAligned: Math.abs(mb.right - ab.right) <= 2, bottomInView: mb.bottom <= innerHeight + 0.5 };
    })(),
    cpMenus: document.querySelectorAll('.cp-menu').length,
    refreshMenu: !!document.querySelector('.refresh-menu'),
    suggest: !!document.querySelector('.sug-panel'),
    store: localStorage.getItem('whbis:copy-mode'),
  };
})()`

const click = (sel, i = 0) => evalV(`(() => { const n = document.querySelectorAll('${sel}')[${i}]; if (!n) return null; n.click(); return true })()`)

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await seedLogin({ send, BASE, sleep })

  // 清掉历史档位，从默认 text 起验
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(300)
  await send('Page.navigate', { url: BASE })
  await sleep(1500)
  console.log('SEED=' + JSON.stringify(await evalV(
    `uni.removeStorageSync('whbis:copy-mode'); uni.setStorageSync('whbis:min-stops-mode', true);` +
    `({ minMode: uni.getStorageSync('whbis:min-stops-mode'), copyMode: uni.getStorageSync('whbis:copy-mode') })`
  )))

  // ① 地图页：车辆面板 + 发车时刻两个胶囊
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(500)
  await send('Page.navigate', { url: MAP_URL })
  await sleep(11000)
  console.log('A=地图页 ' + JSON.stringify(await evalV(READ)))

  // ② 点控制卡「线路」档位，开实时线路浮窗（极简面板的 3 个胶囊一起在场）
  console.log('TABS=' + JSON.stringify(await evalV(
    `(() => { const all = [...document.querySelectorAll('.seg-tab')]; return { tabs: all.map((n) => n.innerText.trim()), clicked: all.find((n) => n.innerText.trim() === '线路') ? !!all.find((n) => n.innerText.trim() === '线路').click() : null } })()`
  )))
  await sleep(7000)
  console.log('B=实时线路窗 ' + JSON.stringify(await evalV(READ)))

  // ③ 窗头点「▤ 极简站牌」：极简面板的 3 个复制胶囊随之出现
  await evalV(`(() => { const b = [...document.querySelectorAll('.fw-actions .fw-act')].find((n) => n.innerText.includes('极简')); if (!b) return null; b.click(); return true })()`)
  await sleep(1500)
  console.log('C=极简面板 ' + JSON.stringify(await evalV(READ)))

  // ④ 展开第一个胶囊（线路）的档位下拉
  await evalV(`(() => { const a = document.querySelectorAll('.copy-pill .cp-mode'); a[0].click(); return a.length })()`)
  await sleep(350)
  console.log('D=展开下拉 ' + JSON.stringify(await evalV(READ)))

  // ⑤ 选「复制为 Excel」：同屏 5 个胶囊应全部同步
  await click('.cp-opt', 1)
  await sleep(450)
  console.log('E=切Excel ' + JSON.stringify(await evalV(READ)))

  // ⑥ 再从最后一个胶囊切「图片」：5 个同样一起变
  await evalV(`(() => { const a = document.querySelectorAll('.copy-pill .cp-mode'); a[a.length - 1].click(); return a.length })()`)
  await sleep(350)
  await click('.cp-opt', 2)
  await sleep(450)
  console.log('F=切图片 ' + JSON.stringify(await evalV(READ)))

  // ⑦ 线路库：列表头的「匹配 N 条」旁也应是同一枚胶囊（继承「图片」档位）
  await evalV(`(() => { const t = [...document.querySelectorAll('.seg-tab')].find((n) => n.innerText.trim() === '线路库'); if (!t) return null; t.click(); return true })()`)
  await sleep(6000)
  console.log('G=线路库 ' + JSON.stringify(await evalV(READ)))

  // ⑧ 矮视口：按钮离视口底边不足一屏菜单高度时，仍须垂直向下（旧实现在这里会翻到上方）
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 420, deviceScaleFactor: 1, mobile: false })
  await sleep(1600)
  await evalV(`(() => { const a = document.querySelectorAll('.copy-pill .cp-mode'); a[0].click(); return a.length })()`)
  await sleep(350)
  console.log('H=矮视口展开 ' + JSON.stringify(await evalV(READ)))

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(1200)

  // ⑨ 互斥：展开刷新间隔下拉时，复制下拉必须收起
  await evalV(`(() => { const a = document.querySelector('.rp-mode'); if (!a) return null; a.click(); return true })()`)
  await sleep(350)
  console.log('I=刷新挤掉复制 ' + JSON.stringify(await evalV(READ)))

  // ⑩ 反向：展开复制下拉时，刷新下拉必须收起
  await evalV(`(() => { const a = document.querySelector('.copy-pill .cp-mode'); if (!a) return null; a.click(); return true })()`)
  await sleep(350)
  console.log('J=复制挤掉刷新 ' + JSON.stringify(await evalV(READ)))

  // ⑪ 同屏连点两个复制胶囊：只能留一个菜单
  await evalV(`(() => { const a = document.querySelectorAll('.copy-pill .cp-mode'); if (a.length < 2) return null; a[0].click(); a[1].click(); return a.length })()`)
  await sleep(350)
  console.log('K=胶囊互斥 ' + JSON.stringify(await evalV(READ)))

  // ⑫ 点空白处：所有就地菜单统一收起
  await evalV(`document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`)
  await sleep(350)
  console.log('L=点空白 ' + JSON.stringify(await evalV(READ)))

  // ⑬ 搜索联想同样参与互斥：切回地图页让搜索框可见，再用 CDP 真实键入
  await evalV(`(() => { const t = [...document.querySelectorAll('.seg-tab')].find((n) => n.innerText.trim() === '地图'); if (!t) return null; t.click(); return true })()`)
  await sleep(1200)
  await evalV(`(() => { const i = document.querySelector('input.search-input') || document.querySelector('.search-input input') || document.querySelector('input'); if (!i) return null; i.focus(); return i.className })()`)
  await send('Input.insertText', { text: '337' })
  await sleep(700)
  console.log('M=联想展开 ' + JSON.stringify(await evalV(READ)))

  // ⑭ 联想面板过去没有点外部关闭，现在由仲裁器统一接管
  await evalV(`document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`)
  await sleep(350)
  console.log('N=联想点空白 ' + JSON.stringify(await evalV(READ)))

  child.kill()
  process.exit(0)
}
