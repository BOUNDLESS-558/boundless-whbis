/**
 * 车辆图标点击体检：点地图上的车点 → 弹出车辆详情窗。
 * 两条路径都验：① 自绘走向图的 SVG 车点（真实鼠标点击 / 连点两次＝双击）
 *              ② 原生地图的 markertap（uni-h5 把参数放在 e.detail 里，这里模拟两种事件形状）
 * 用法：node scripts/probe-marker-tap.mjs [线路号]
 * 依赖：先 npm run dev:h5，并用 PROBE_BASE 指定地址（默认 http://localhost:5173/boundless-whbis/）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9343
const PROFILE = path.join(process.env.TMP || '.', 'edge-tap-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE = `${BASE}#/pages/map/map?lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description)
  return r && r.result ? r.result.value : null
}

// AGENTS.md：探针不产出任何文件。shot() 保留为空实现，调用点不动。
async function shot(name) {
  return null
}

// 车辆详情窗是否打开 / 显示的是哪辆车
const readSheet = () => evalV(`(() => {
  const sheet = document.querySelector('.bus-sheet');
  if (!sheet) return { open: false };
  const title = (sheet.querySelector('.sheet-line') || {}).innerText || '';
  const dir = (sheet.querySelector('.sheet-dir') || {}).innerText || '';
  const rows = [...sheet.querySelectorAll('.sheet-row')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim());
  return { open: true, title: title.trim(), dir: dir.trim(), orgId: rows.find((r) => r.startsWith('自编号')) || null };
})()`)

// 取一个 SVG 车点（外层 <g> 里含 r=15 的光晕圈）的屏幕中心
const busDotPos = () => evalV(`(() => {
  const g = [...document.querySelectorAll('.route-svg g')].find((n) => n.querySelector('circle[r="15"]'));
  if (!g) return null;
  const b = g.getBoundingClientRect();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
})()`)

const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(40)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(350)
}
const clickSel = (sel) => evalV(`(() => { const b = document.querySelector('${sel}'); if (b) { b.click(); return 'ok' } return 'not-found' })()`)

// 直接对页面实例调 onMarkerTap，模拟原生地图 markertap（uni-h5 的形状 + 老式扁平形状）
const fireMarkerTap = (payload) => evalV(`(() => {
  let cur = document.querySelector('.schematic') && document.querySelector('.schematic').__vueParentComponent;
  for (let hop = 0; cur && hop < 40; hop++) {
    const p = cur.proxy || cur.ctx;
    if (p && typeof p.onMarkerTap === 'function') { p.onMarkerTap(${payload}); return 'called' }
    cur = cur.parent;
  }
  return 'no-page-vm';
})()`)

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(9000)

  const markers = await evalV(`(() => {
    let cur = document.querySelector('.schematic') && document.querySelector('.schematic').__vueParentComponent;
    for (let hop = 0; cur && hop < 40; hop++) {
      const p = cur.proxy || cur.ctx;
      if (p && p.markers) {
        const bus = p.markers.filter((m) => m.id >= 20000);
        const stop = p.markers.filter((m) => m.id < 10000);
        return { total: p.markers.length, busIds: bus.map((m) => m.id), busCount: bus.length,
          // title 在 uni-h5 里会变成 callout，点击时被切到可见 → 应为 0
          busWithTitle: bus.filter((m) => m.title).length,
          busWithCallout: bus.filter((m) => m.callout).length,
          stopWithTitle: stop.filter((m) => m.title).length,
          stopWithLabel: stop.filter((m) => m.label && m.label.content).length };
      }
      cur = cur.parent;
    }
    return null;
  })()`)
  console.log('--- 标记 id / title、callout 计数（title 与 callout 必须全为 0）')
  console.log(JSON.stringify(markers))

  // ① 真实鼠标点 SVG 车点
  const dot = await busDotPos()
  console.log('--- SVG 车点屏幕坐标:', JSON.stringify(dot))
  await clickAt(dot.x, dot.y)
  const single = await readSheet()
  console.log('--- 单击车点后:', JSON.stringify(single))
  await shot('tap-1-car-dot.jpg')

  // ② 连点两次（双击语义）：窗口应仍在，且是同一辆车
  await clickAt(dot.x, dot.y)
  await clickAt(dot.x, dot.y)
  const dbl = await readSheet()
  console.log('--- 双击（连点两次）后:', JSON.stringify(dbl))

  // ③ 关闭，再走原生 markertap 的两条事件形状
  await clickSel('.sheet-close')
  await sleep(300)
  console.log('--- 关闭后:', JSON.stringify(await readSheet()))

  console.log('markertap(uni 形状 {detail:{markerId}}):', await fireMarkerTap(`{ detail: { markerId: ${markers.busIds[0]} } }`))
  await sleep(350)
  const t1 = await readSheet()
  console.log('--- uni 形状 markertap 后:', JSON.stringify(t1))

  await clickSel('.sheet-close')
  await sleep(300)
  console.log('markertap(扁平形状 {markerId}):', await fireMarkerTap(`{ markerId: ${markers.busIds[0]} }`))
  await sleep(350)
  const t2 = await readSheet()
  console.log('--- 扁平形状 markertap 后:', JSON.stringify(t2))
  await shot('tap-2-marker-tap.jpg')

  // ④ 站点标记不应弹窗（id 5000 段只弹 toast）
  await clickSel('.sheet-close')
  await sleep(300)
  console.log('markertap(站点 5003):', await fireMarkerTap('{ detail: { markerId: 5003 } }'))
  await sleep(350)
  const t3 = await readSheet()
  console.log('--- 站点标记后（应 open=false）:', JSON.stringify(t3))

  console.log('==== 结论 ====')
  console.log('单击车点:', single.open ? '✓ 打开 ' + single.title + single.dir : '✗ 没打开')
  console.log('双击车点:', dbl.open ? '✓ 仍打开 ' + dbl.title + dbl.dir : '✗ 没打开')
  console.log('原生 markertap（uni 形状）:', t1.open ? '✓ 打开 ' + t1.orgId : '✗ 没打开')
  console.log('原生 markertap（扁平形状）:', t2.open ? '✓ 打开 ' + t2.orgId : '✗ 没打开')
  console.log('站点标记不弹窗:', t3.open ? '✗ 误弹窗' : '✓')
  console.log(`标记白框（title/callout）: 车辆 title=${markers.busWithTitle} callout=${markers.busWithCallout} | 站点 title=${markers.stopWithTitle}（应全为 0，站点 label=${markers.stopWithLabel} 保留）`)
  ws.close(); child.kill(); process.exit(0)
}
