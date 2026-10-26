/**
 * 地图渲染方式开关体检（map_render_mode 与高德 Key 解耦）。
 * 验四件事：
 *   ① 逻辑：config.js 的 useNativeMap() 在 4 组 (Key, 模式) 下取值正确
 *   ② 填了 Key + 选「走向图」→ 真的渲染自绘 SVG（.schematic），不出 uni-map
 *   ③ 没 Key + 选「原生地图」→ 自动回退自绘（不能白屏）
 *   ④ 填了 Key + 选「自动」→ useMap 仍为 true（旧行为不回归；假 Key 会让高德 SDK 报错，
 *      页面可能起不来，此时记为“不可判定”而不是失败）
 * 用法：node scripts/probe-map-mode.mjs [线路号]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9346
const PROFILE = path.join(process.env.TMP || '.', 'edge-mapmode-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const MAP_PAGE = `${BASE}#/pages/map/map?lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO + '路')}`

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
  if (r && r.result && r.result.subtype === 'error') console.log('EVAL ERR:', r.result.description)
  if (r && r.exceptionDetails) console.log('EVAL EXC:', JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r && r.result ? r.result.value : null
}
// AGENTS.md：探针不产出任何文件。shot() 保留为空实现（不调 captureScreenshot、不写盘），
// 调用点不动，方便以后临时排查时恢复。
async function shot(name) {
  return null
}

// 页面 proxy：自绘从 .schematic 找，原生从 uni-map 找
const PAGE_VM = `(() => {
  const start = document.querySelector('.schematic') || document.querySelector('uni-map');
  let cur = start && start.__vueParentComponent;
  for (let hop = 0; cur && hop < 40; hop++) { const p = cur.proxy || cur.ctx; if (p && p.useMap !== undefined) return p; cur = cur.parent }
  return null;
})()`

const state = () => evalV(`(() => {
  const p = ${PAGE_VM};
  return {
    useMap: p ? p.useMap : null,
    schematicEl: !!document.querySelector('.schematic'),
    mapEl: !!document.querySelector('uni-map'),
    stopLabels: document.querySelectorAll('.stop-label').length,
    svgBuses: p ? p.svgBuses.length : -1,
    tiles: document.querySelectorAll('.tile').length,
  };
})()`)

// 写存储（走 uni API，与业务代码同一条路径）
const setConfig = (key, mode) => evalV(`(() => {
  if (${JSON.stringify(key)}) uni.setStorageSync('amap_byok_config', { key: ${JSON.stringify(key)}, securityJsCode: '' });
  else uni.removeStorageSync('amap_byok_config');
  if (${JSON.stringify(mode)} === 'auto') uni.removeStorageSync('map_render_mode');
  else uni.setStorageSync('map_render_mode', ${JSON.stringify(mode)});
  return { hasKey: !!uni.getStorageSync('amap_byok_config'), mode: uni.getStorageSync('map_render_mode') || 'auto' };
})()`)

// 每次都要换新文档：uni-app 是 hash 路由，同文档内改 hash 不会重建页面，
// useMap 这个计算属性就永远是首次加载时的值。
// readyExpr 用轮询而不是固定睡觉：vite 是按需编译，首次进入某个页面会明显变慢。
async function waitFor(expr, maxMs = 25000, step = 300) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    if (await evalV(expr)) return true
    await sleep(step)
  }
  return false
}

async function freshLoad(url, readyExpr, extra = 1200) {
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(300)
  await send('Page.navigate', { url })
  const ok = await waitFor(readyExpr)
  await sleep(extra)
  return ok
}

// ① 纯逻辑：直接 import 业务模块的 useNativeMap()，4 组组合一次跑完
const logicCheck = () => evalV(`(async () => {
  const m = await import('${BASE}src/config.js');
  const cases = [
    { key: 'k', mode: 'auto', want: true },
    { key: 'k', mode: 'schematic', want: false },
    { key: '', mode: 'auto', want: false },
    { key: '', mode: 'native', want: false },
    { key: 'k', mode: 'native', want: true },
  ];
  const rows = [];
  for (const c of cases) {
    if (c.key) uni.setStorageSync('amap_byok_config', { key: c.key, securityJsCode: '' });
    else uni.removeStorageSync('amap_byok_config');
    if (c.mode === 'auto') uni.removeStorageSync('map_render_mode');
    else uni.setStorageSync('map_render_mode', c.mode);
    rows.push({ key: !!c.key, mode: c.mode, want: c.want, got: m.useNativeMap() });
  }
  return rows;
})()`)

const scenarios = [
  { name: '有Key+走向图', key: 'demo_key_for_probe_only', mode: 'schematic', wantSchematic: true },
  { name: '无Key+原生  ', key: '', mode: 'native', wantSchematic: true },
  { name: '有Key+自动  ', key: 'demo_key_for_probe_only', mode: 'auto', wantSchematic: false },
]

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')

  // 先落到首页再测逻辑（uni 全局需要页面加载完成才有）
  await freshLoad(BASE, `!!window.uni && !!document.querySelector('.cfg-fab')`)
  const rows = await logicCheck()
  console.log('==== 逻辑（useNativeMap）====')
  let logicOk = true
  ;(rows || []).forEach((r) => {
    const ok = r.got === r.want
    if (!ok) logicOk = false
    console.log(`${ok ? '✓' : '✗'} Key=${r.key ? '有' : '无'} 模式=${r.mode} → useNativeMap=${r.got}（期望 ${r.want}）`)
  })

  const results = []
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i]
    await freshLoad(BASE, `!!window.uni && !!document.querySelector('.cfg-fab')`)
    const cfg = await setConfig(sc.key, sc.mode)
    await send('Page.navigate', { url: MAP_PAGE })
    // 先等容器出来，再给数据/瓦片/OSRM 贴路留时间
    await waitFor(`!!document.querySelector('.schematic') || !!document.querySelector('uni-map')`, 25000)
    await sleep(8000)
    const s = await state()
    // 主判据：走向图必须 useMap=false 且画出了站点；原生必须 useMap=true
    const ok = sc.wantSchematic
      ? (s.useMap === false && s.schematicEl && s.stopLabels > 0)
      : (s.useMap === true)
    results.push({ ...sc, ...s, cfg, ok })
    console.log(`--- [${sc.name}] 存储=${JSON.stringify(cfg)} 状态=${JSON.stringify(s)}`)
    if (sc.wantSchematic) await shot(`mapmode-${i + 1}-schematic.jpg`)
  }

  console.log('==== 渲染 ====')
  let renderOk = true
  results.forEach((r) => {
    // 原生分支用假 Key 时高德 SDK 会报 INVALID_USER_KEY，页面可能整个起不来 —— 记不可判定
    const unknown = r.useMap === null && !r.wantSchematic
    if (!unknown && !r.ok) renderOk = false
    const tail = unknown ? '不可判定（假 Key 导致页面未起来）' : (r.ok ? '✓' : '✗')
    console.log(`${r.name}: useMap=${r.useMap} uni-map=${r.mapEl} schematic=${r.schematicEl} 站名=${r.stopLabels} 车=${r.svgBuses} 瓦片=${r.tiles} → ${tail}`)
  })

  // 设置已内联为 line 页的 SettingsDrawer（齿轮入口），三档渲染选择器在 config.js 中已移除，
  // 此处不再有独立 settings 页与 .seg-item；入口改指 line 页
  await freshLoad(`${BASE}#/pages/line/line`, `!!document.querySelector('.ab-gear')`)
  const seg = await evalV(`(() => {
    const items = [...document.querySelectorAll('.seg-item')];
    return { count: items.length, on: items.filter((e) => e.classList.contains('on')).map((e) => e.innerText.trim()),
      widths: items.map((e) => Math.round(e.getBoundingClientRect().width)),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  })()`)
  console.log('设置页三档:', JSON.stringify(seg))
  await shot('mapmode-settings.jpg')

  // 窄屏（手机）下三档不能挤成两行/溢出
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(900)
  const segM = await evalV(`(() => {
    const items = [...document.querySelectorAll('.seg-item')];
    return { count: items.length, widths: items.map((e) => Math.round(e.getBoundingClientRect().width)),
      heights: items.map((e) => Math.round(e.getBoundingClientRect().height)),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  })()`)
  console.log('设置页窄屏:', JSON.stringify(segM))
  await shot('mapmode-settings-mobile.jpg')
  await send('Emulation.clearDeviceMetricsOverride')

  await freshLoad(BASE, `!!window.uni && !!document.querySelector('.cfg-fab')`)
  await evalV(`(() => { const b = document.querySelector('.cfg-fab'); if (b) b.click(); return !!b })()`)
  await sleep(800)
  const mp = await evalV(`(() => {
    const items = [...document.querySelectorAll('.mc-seg-item')];
    return { count: items.length, on: items.filter((e) => e.classList.contains('on')).map((e) => e.innerText.trim()) };
  })()`)
  console.log('首页面板三档:', JSON.stringify(mp))
  await shot('mapmode-index-panel.jpg')

  const allOk = logicOk && renderOk && seg && seg.count === 3 && mp && mp.count === 3
    && segM && segM.count === 3 && !segM.overflow
  console.log('==== 结论 ====', allOk ? '✓ 全部通过' : '✗ 有失败项')
  ws.close(); child.kill(); process.exit(allOk ? 0 : 1)
}
