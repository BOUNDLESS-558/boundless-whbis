/**
 * 首页线路号联想体检。验五件事：
 *   ① 输入即出面板：贴着搜索行下沿、宽度撑满主控卡、浮在上层（不撑高布局）
 *   ② 排序口径：完全相等 > 前缀 > 包含（输入 3 → 3 路排第一；输入 k1 → K1、K2 之后才是 K202）
 *   ③ 面板头两行：命中总数 + 线路库总条数（来自 src/data/lines.json）
 *   ④ 白名单：J / P / T / V / G / H / Z 等非本集团前缀必须「未收录」（库里只有 数字 / 电 / BRT / K / D）
 *   ⑤ 点选一条 → 面板与遮罩一起关闭、输入框回填，随后切到地图态（控制卡线路号 = 命中线路）
 * 只打控制台，不写截图 / 日志 / 构建产物（本项目约定：探针不留产物）
 * 用法：node scripts/probe-line-suggest.mjs
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9356
const PROFILE = path.join(process.env.TMP || '.', 'edge-sug-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

// 首页就是 map 页：冷启动（未选线）时是「独立顶栏搜索卡 + 线路库整屏」，
// 联想面板挂在这一份 LineSearch（plain=false，带遮罩与齿轮）里
const URL_HOME = `${BASE}#/pages/map/map`
const READY = `!!window.uni && !!document.querySelector('.home-top .mod-main input')`

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
// vite 按需编译，首屏明显变慢：轮询等元素出来，别用固定 sleep 赌时间
const waitFor = async (expr, ms = 24000) => {
  for (let t = 0; t < ms; t += 400) {
    if (await evalV(`(() => { try { return (${expr}) } catch (e) { return false } })()`)) return true
    await sleep(400)
  }
  return false
}

/** 往搜索框里塞值：uni-app 的 <input> 在 H5 下是 uni-input 套原生 input，直接派发原生 input 事件 */
const typeIn = (v) => evalV(`(() => {
  const card = document.querySelector('.mod-main');
  const el = card && card.querySelector('input');
  if (!el) return { err: 'no input' };
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { value: el.value };
})()`)

const MEASURE = `(() => {
  const r = (n) => { const b = n.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } };
  const card = document.querySelector('.mod-main');
  const row = document.querySelector('.search-row');
  const panel = document.querySelector('.sug-panel');
  const mask = document.querySelector('.sug-mask');
  const items = [...document.querySelectorAll('.sug-item')].map((n) => ({
    no: (n.querySelector('.sug-no') || {}).innerText || '',
    route: ((n.querySelector('.sug-route') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
    meta: ((n.querySelector('.sug-meta') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
  }));
  const ps = panel ? getComputedStyle(panel) : null;
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    rpx: +(document.documentElement.clientWidth / 750).toFixed(3),
    card: card ? r(card) : null,
    row: row ? r(row) : null,
    panel: panel ? {
      box: r(panel), cls: panel.className, z: ps.zIndex, pos: ps.position, bg: ps.backgroundColor,
      clientH: panel.clientHeight, scrollH: panel.scrollHeight,
      overflow: panel.scrollHeight > panel.clientHeight + 1,
    } : null,
    headT: (document.querySelector('.sug-head-t') || {}).innerText || '',
    headS: (document.querySelector('.sug-head-s') || {}).innerText || '',
    items,
    none: (document.querySelector('.sug-empty') || {}).innerText || '',
    mask: mask ? { box: r(mask), z: getComputedStyle(mask).zIndex } : null,
    val: card ? (card.querySelector('input') || {}).value : null,
    // 点选后应切到地图态：LineMap 挂载 + 控制卡方向行的线路号徽章 = 命中的线路号
    mapOn: !!document.querySelector('.lmap-page'),
    ctrlOn: !!document.querySelector('.ctrl .dir-cur'),
    curNo: ((document.querySelector('.ctrl .dir-cur .dc-no') || {}).innerText || '').trim(),
  };
})()`

const cases = [
  { kw: '3', note: '纯数字：完全相等优先' },
  { kw: '538', note: '三位数精确命中' },
  { kw: '电', note: '中文前缀（5 条：电1/2/3/4/8）' },
  { kw: 'k1', note: '字母前缀 + 数字（K1、K2 先于 K202）' },
  { kw: '５３８', note: '全角数字归一化' },
  { kw: 'J1', note: '非本集团前缀（应未收录）', expectNone: true },
  { kw: 'G73', note: '非本集团前缀（应未收录）', expectNone: true },
]

const judge = (m, c) => {
  const out = []
  if (!m || !m.card) return ['✗ 没找到搜索卡片']
  if (c.expectNone) {
    out.push(`「${c.kw}」面板=${m.panel ? '在' : '不在'} 未收录提示=${m.none ? '「' + m.none + '」' : '无'} ${m.panel && m.none && !m.items.length ? '✓' : '✗（白名单失效，误收录）'}`)
    return out
  }
  if (!m.panel) { out.push(`✗ 输入「${c.kw}」后面板没出现`); return out }
  // 浮层定位：贴在搜索行下沿、宽度跟主控卡一致（卡片有 2rpx 描边，容差 6px）
  const gapT = +(m.panel.box.t - m.row.b) .toFixed(1)
  const dl = +(m.panel.box.l - m.card.l).toFixed(1)
  const dr = +(m.panel.box.r - m.card.r).toFixed(1)
  out.push(`面板 ${m.panel.box.w}×${m.panel.box.h}px position=${m.panel.pos} z=${m.panel.z} 距搜索行下沿 ${gapT}px 左右对齐 dl=${dl} dr=${dr} ${gapT >= 0 && gapT <= 14 && Math.abs(dl) <= 6 && Math.abs(dr) <= 6 ? '✓' : '✗'}`)
  out.push(`  不透明底色=${m.panel.bg} 内部滚动=${m.panel.overflow ? '有（' + m.panel.clientH + '/' + m.panel.scrollH + '）' : '无'}`)
  out.push(`面板头：「${m.headT}」/「${m.headS}」${/^相关线路 \d+ 条$/.test(m.headT) ? '✓' : '✗'}`)
  out.push(`遮罩=${m.mask ? '在 z=' + m.mask.z : '无'} ${m.mask && Number(m.mask.z) < Number(m.panel.z) ? '✓（低于面板）' : '✗'}`)
  out.push(`条目 ${m.items.length} 条：` + m.items.map((x) => x.no).join(' · '))
  m.items.slice(0, 3).forEach((x) => out.push(`  ${x.no} | ${x.route} | ${x.meta}`))
  // 排序口径
  const first = m.items[0] ? m.items[0].no : ''
  if (c.first) out.push(`首项=${first} 期望=${c.first} ${first === c.first ? '✓' : '✗'}`)
  if (c.prefix) out.push(`全部以「${c.prefix}」开头=${m.items.every((x) => x.no.startsWith(c.prefix)) ? '✓' : '✗'}`)
  if (c.total) out.push(`命中总数 ${c.total} ${new RegExp('相关线路 ' + c.total + ' 条').test(m.headT) ? '✓' : '✗'}`)
  return out
}

const runCase = async (c) => {
  await typeIn(c.kw)
  await sleep(600)
  const m = await evalV(MEASURE)
  console.log(`\n---- 输入「${c.kw}」（${c.note}）----`)
  for (const line of judge(m, c)) console.log(line)
  return m
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop', mobile: false }, { w: 390, h: 844, tag: 'mobile', mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Page.navigate', { url: URL_HOME })
    const up = await waitFor(READY)
    console.log(`\n======== ${vp.tag} ${vp.w}x${vp.h}（实测视口 ${await evalV('window.innerWidth')}px，顶栏就绪=${up ? '✓' : '✗'}）========`)

    for (const c of cases) {
      if (c.kw === '3') { c.first = '3' }
      if (c.kw === '538' || c.kw === '５３８') { c.first = '538' }
      if (c.kw === '电') { c.first = '电1'; c.prefix = '电'; c.total = 5 }
      if (c.kw === 'k1') { c.prefix = 'K'; c.first = 'K1' }
      await runCase(c)
    }

    // 点选交互（只在桌面视口做一次）
    if (vp.tag === 'desktop') {
      await typeIn('电')
      await sleep(600)
      const before = await evalV(`(() => { const n = document.querySelector('.sug-item'); return n ? n.querySelector('.sug-no').innerText : null })()`)
      await evalV(`document.querySelector('.sug-item').click()`)
      // 选线后整块视图换成地图（顶栏卸载、搜索行并入控制卡），要给数据加载留时间
      await waitFor(`!!document.querySelector('.ctrl .dir-cur .dc-no')`, 20000)
      await sleep(1500)
      const after = await evalV(MEASURE)
      // 点选后：联想面板与遮罩关闭；搜索行随顶栏搬进控制卡，输入框按选中的线路号回填；
      // 地图挂载 + 方向行线路号徽章显示同一条线路，才算真的「直达对应线路」
      const ok = !!(after && !after.panel && !after.mask && after.val === before
        && after.mapOn && after.ctrlOn && after.curNo === before)
      console.log(`\n---- 点选「${before}」----`)
      console.log(`面板关闭=${after && !after.panel ? '✓' : '✗'} 遮罩关闭=${after && !after.mask ? '✓' : '✗'} 输入框回填=${after && after.val} ${after && after.val === before ? '✓' : '✗'}`)
      console.log(`地图挂载=${after && after.mapOn ? '✓' : '✗'} 控制卡在=${after && after.ctrlOn ? '✓' : '✗'} 控制卡线路号=${after && after.curNo} 期望=${before} ${after && after.curNo === before ? '✓' : '✗'} 综合=${ok ? '✓' : '✗'}`)
    }
  }

  ws.close(); child.kill(); process.exit(0)
}
