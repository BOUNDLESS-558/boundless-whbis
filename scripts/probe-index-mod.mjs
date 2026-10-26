/**
 * 首页「模块卡」体检：确认整卡包裹 + 行分块的新版式在宽/窄屏都不散架。
 * 验五件事：
 *   ① 模块栈居中等宽（.stack 左右留白对称），没有横向溢出
 *   ② 主控卡 / 设置卡 / 结果卡都是 .mod 整卡，内部靠 .mod-row + .mod-div 分块
 *   ③ 结果卡头：方向分段（全部/上行/下行）与「337 · 2 个方向」同排，不换行
 *   ④ 结果行：徽标 / 走向 / chips 三段齐全，行高不塌
 *   ⑤ 点「上行」只剩 1 行、tab 选中态转移正确
 * 只打控制台，不写截图 / 日志（本项目约定：探针不留产物）
 * 用法：node scripts/probe-index-mod.mjs
 * 依赖：先 npm run dev:h5，且首页快捷线路里有 337
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9357
const PROFILE = path.join(os.tmpdir(), 'edge-index-mod')
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
    const p = list.find((t) => t.type === 'page')
    if (p) { wsUrl = p.webSocketDebuggerUrl; break }
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

const MEASURE = `(() => {
  const box = (n) => {
    if (!n) return null;
    const b = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), z: cs.zIndex, ov: cs.overflowX };
  };
  const q = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('.line-row')].map((n) => ({
    h: box(n).h,
    badge: box(n.querySelector('.lr-badge')),
    metaH: (box(n.querySelector('.lr-meta')) || {}).h || 0,
    chips: n.querySelectorAll('.chip').length,
    route: ((n.querySelector('.lr-route') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
  }));
  return {
    vw: innerWidth,
    scrollW: document.documentElement.scrollWidth,
    stack: box(q('.stack')),
    mods: [...document.querySelectorAll('.mod')].map((n) => ({ cls: n.className, ...box(n) })),
    head: {
      h: (box(q('.result-head')) || {}).h || 0,
      seg: box(q('.rh-seg')),
      s: box(q('.rh-s')),
      sText: (q('.rh-s') || {}).innerText || '',
    },
    tabs: [...document.querySelectorAll('.rh-tab')].map((t) => t.innerText + ':' + (t.className.indexOf('on') > -1 ? 'on' : 'off')),
    rows,
  };
})()`

const report = (m, vp) => {
  console.log(`\n======== ${vp.tag} ${vp.w}x${vp.h} ========`)
  console.log(`scrollW=${m.scrollW} vw=${m.vw} 横向溢出=${m.scrollW > m.vw + 1 ? '✗ 有' : '✓ 无'}`)
  const st = m.stack
  const padL = +st.l.toFixed(1)
  const padR = +(m.vw - st.l - st.w).toFixed(1)
  console.log(`stack w=${st.w} 左留白=${padL} 右留白=${padR} 居中=${Math.abs(padL - padR) <= 1 ? '✓' : '✗'}`)
  m.mods.forEach((x) => console.log(`  .mod ${x.cls} w=${x.w} h=${x.h} z=${x.z} overflowX=${x.ov}`))
  console.log(`result-head h=${m.head.h} seg=${m.head.seg ? m.head.seg.w + 'x' + m.head.seg.h : '无'} 文案=「${m.head.sText}」`)
  const sameLine = !!(m.head.seg && m.head.s && Math.abs(m.head.seg.t - m.head.s.t) < m.head.seg.h)
  console.log(`  分段与文案同排=${sameLine ? '✓' : '✗（换行了）'} tabs=${m.tabs.join(' | ')}`)
  m.rows.forEach((r, i) => console.log(`  行${i + 1} h=${r.h} badge=${r.badge ? r.badge.w + 'x' + r.badge.h : '无'} chips=${r.chips} metaH=${r.metaH} | ${r.route}`))
  console.log(`  结果行=${m.rows.length} ${m.rows.length >= 2 ? '✓' : '✗'} · 每行都有徽标与 chips=${m.rows.every((r) => r.badge && r.chips >= 4) ? '✓' : '✗'}`)
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
    // 先回空白页：同文档内只改 hash 不会重载，会把上个视口的组件 state 带过来
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(300)
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 500 })
    if (vp.w < 500) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Page.navigate', { url: `${BASE}#/pages/index/index?run=${vp.w}` })
    await sleep(6000)

    // 用快捷胶囊出结果（337 在默认快捷列表里）
    const clicked = await evalV(`(() => { const n = [...document.querySelectorAll('.quick-tag')].find(e => e.innerText.trim() === '337'); if (!n) return false; n.click(); return true })()`)
    if (!clicked) { console.log('✗ 没找到快捷胶囊 337'); continue }
    await sleep(4500)

    report(await evalV(MEASURE), vp)

    // 方向分段：切「上行」只剩一条
    await evalV(`[...document.querySelectorAll('.rh-tab')].find(n => n.innerText.trim() === '上行').click()`)
    await sleep(400)
    const after = await evalV(`({ rows: document.querySelectorAll('.line-row').length, tabs: [...document.querySelectorAll('.rh-tab')].map(t => t.innerText + ':' + (t.className.indexOf('on') > -1 ? 'on' : 'off')) })`)
    console.log(`  切「上行」后 行=${after.rows} ${after.rows === 1 ? '✓' : '✗'} tabs=${after.tabs.join(' | ')}`)

    // 设置卡：齿轮展开后应是一张独立模块卡
    if (!(await evalV(`!!document.querySelector('.mc-title')`))) {
      await evalV(`document.querySelector('.search-row .row-btn').click()`)
      await sleep(700)
    }
    const set = await evalV(`(() => { const n = [...document.querySelectorAll('.mod')].find(e => e.querySelector('.mc-title')); if (!n) return null; const b = n.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), rows: n.querySelectorAll('.mod-row').length, divs: n.querySelectorAll('.mod-div').length } })()`)
    console.log(set ? `  设置卡 w=${set.w} h=${set.h} 行=${set.rows} 分割线=${set.divs} ${set.rows >= 1 && set.divs >= 1 ? '✓' : '✗'}` : '✗ 设置卡没展开')
  }

  ws.close(); child.kill(); process.exit(0)
}
