/**
 * 左上角控制卡「全部 / 上行 / 下行 / 337 路 / 营运公司徽标」版式体检。
 * 验三件事：
 *   ① 徽标在线路号**同一行**、紧跟在它后面（不是第二排、不被 margin-left:auto 甩到最右）
 *   ② 全部/上行/下行 三个 tab 的文字**水平 + 垂直都居中**（用 Range 取真实文字盒中心，和 tab 盒中心比）
 *   ③ 窄屏（360px）下公司名宁可省略号，也不许换行 / 溢出
 * 用法：node scripts/probe-ctrl-row.mjs [线路号]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const OUT = path.join('.openchamber', 'screenshots')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9344
const PROFILE = path.join(process.env.TMP || '.', 'edge-ctrl-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
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

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 78 })
  if (s && s.data) { fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64')); console.log('screenshot:', name) }
}

// 量：tab 盒 / tab 文字盒 / 方向行 / 线路号 / 徽标，全部换算成屏幕 px
const MEASURE = `(() => {
  const r = (n) => { const b = n.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), cy: +(b.top + b.height / 2).toFixed(1), cx: +(b.left + b.width / 2).toFixed(1) } };
  // 文字真实墨迹盒：Range 覆盖元素里的文本节点
  const textBox = (n) => {
    const t = [...n.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim());
    if (!t) return null;
    const rg = document.createRange(); rg.selectNodeContents(t);
    const b = rg.getBoundingClientRect();
    return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), cy: +(b.top + b.height / 2).toFixed(1), cx: +(b.left + b.width / 2).toFixed(1) };
  };
  const dir = document.querySelector('.ctrl-dir');
  if (!dir) return { err: 'no .ctrl-dir' };
  const tabs = [...dir.querySelectorAll('.dir-tab')].map((n) => ({ text: n.innerText.trim(), box: r(n), txt: textBox(n), active: n.classList.contains('active') }));
  const cur = dir.querySelector('.dir-cur');
  const org = dir.querySelector('.ctrl-org');
  const tag = dir.querySelector('.org-tag');
  const name = dir.querySelector('.org-name');
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    rpx: +(document.documentElement.clientWidth / 750).toFixed(3),
    dir: r(dir),
    tabs, cur: r(cur), org: org ? r(org) : null, tag: tag ? r(tag) : null,
    tagText: tag ? tag.innerText.replace(/\\s+/g, ' ').trim() : null,
    nameEllipsis: name ? { scroll: name.scrollWidth, client: name.clientWidth, truncated: name.scrollWidth > name.clientWidth + 1 } : null,
    dirOverflow: dir.scrollWidth > dir.clientWidth + 1,
  };
})()`

const judge = (m) => {
  if (!m || m.err) return ['✗ 没找到控制卡']
  const out = []
  const cy = m.tabs.map((t) => t.box.cy)
  const rowSpread = Math.max(...cy) - Math.min(...cy)
  out.push(`方向行高 ${m.dir.h}px / 单行判定 spread=${rowSpread.toFixed(1)}px ${rowSpread < 1.5 ? '✓' : '✗（换行了）'}`)
  for (const t of m.tabs) {
    const dx = t.txt ? +(t.txt.cx - t.box.cx).toFixed(1) : null
    const dy = t.txt ? +(t.txt.cy - t.box.cy).toFixed(1) : null
    out.push(`  「${t.text}」盒 ${t.box.w}×${t.box.h} 文字偏移 dx=${dx} dy=${dy} ${Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5 ? '✓' : '✗'}`)
  }
  if (m.tag) {
    const sameRow = Math.abs(m.tag.cy - cy[0]) < 1.5
    const gap = +(m.tag.l - m.cur.r).toFixed(1)
    const insideRight = +(m.dir.r - m.tag.r).toFixed(1)
    out.push(`徽标「${m.tagText}」行内=${sameRow ? '✓' : '✗'} 距线路号右边 ${gap}px ${gap >= 0 && gap <= 14 ? '✓' : '✗（应为 0~14，紧邻）'} 距卡片右内边 ${insideRight}px`)
    if (m.nameEllipsis) out.push(`  公司名 省略号=${m.nameEllipsis.truncated ? '是（截断 ' + (m.nameEllipsis.scroll - m.nameEllipsis.client) + 'px）' : '否（完整显示）'}`)
  } else out.push('✗ 没渲染徽标')
  out.push(`卡片横向溢出=${m.dirOverflow ? '✗ 有' : '✓ 无'}`)
  return out
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop', mobile: false }, { w: 390, h: 844, tag: 'mobile', mobile: true }, { w: 360, h: 780, tag: 'narrow360', mobile: true }, { w: 320, h: 700, tag: 'narrow320', mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Page.navigate', { url: URL_PAGE })
    await sleep(vp === 0 ? 9000 : 8000)
    const m = await evalV(MEASURE)
    console.log(`\n==== ${vp.tag} ${vp.w}x${vp.h}（实测视口 ${m && m.vw}px）====`)
    for (const line of judge(m)) console.log(line)
    if (vp.tag === 'desktop' || vp.tag === 'mobile') await shot(`ctrl-row-${vp.tag}.jpg`)
  }

  ws.close(); child.kill(); process.exit(0)
}
