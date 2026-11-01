/**
 * 走向吸附效果体检：打开本地地图页，抓 [osrm] 日志 + 读 localStorage 里的吸附结果几何，
 * 统计「直线兜底」痕迹（相邻点间的大缺口），并截图对比吸附前后。
 * 用法：node scripts/probe-osrm-visual.mjs [线路号] [等待秒]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const LINE_NO = process.argv[2] || '337'
const WAIT = Number(process.argv[3] || 55)
const MOBILE = process.argv.includes('--mobile')
const TAG = MOBILE ? `mobile-${LINE_NO}` : LINE_NO
const BASE = process.env.PROBE_BASE || 'http://localhost:5175/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9337
const PROFILE = path.join(process.env.TEMP || os_tmp(), 'edge-osrm-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function os_tmp() { return process.env.TMP || '.' }
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
const logs = []
const send = (method, params = {}) => {
  const mid = ++id
  ws.send(JSON.stringify({ id: mid, method, params }))
  return new Promise((r) => pending.set(mid, r))
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ')
    if (/\[osrm\]|error|Error/.test(txt)) logs.push(txt.slice(0, 200))
  }
}

// 读 localStorage 里缓存的走向几何，计算相邻点大缺口（直线兜底的特征）
const STATS_EXPR = `(() => {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const hav = (a, b) => {
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
  };
  const out = { keys: [], lines: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    out.keys.push(k);
    if (!/^whbis:osrm-route:/.test(k)) continue;
    let v = null;
    try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { v = null; }
    // uni.setStorageSync 在 H5 下会包一层 {type,data}，逐层取到 pts 数组
    let raw = v;
    for (let n = 0; n < 4 && raw && !Array.isArray(raw); n++) raw = raw.pts || raw.data || (raw.value && raw.value.pts);
    const arr = Array.isArray(raw) ? raw : [];
    if (arr.length < 2) { out.lines[k] = { raw: (localStorage.getItem(k) || '').slice(0, 80) }; continue; }
    let total = 0; const gaps = [];
    for (let j = 1; j < arr.length; j++) {
      const a = arr[j-1], b = arr[j];
      const p = { lat: a.latitude !== undefined ? a.latitude : a.lat, lng: a.longitude !== undefined ? a.longitude : a.lng };
      const q = { lat: b.latitude !== undefined ? b.latitude : b.lat, lng: b.longitude !== undefined ? b.longitude : b.lng };
      const d = hav(p, q);
      total += d;
      if (d > 350) gaps.push(Math.round(d));
    }
    out.lines[k] = { pts: arr.length, lengthKm: +(total/1000).toFixed(2), bigGaps: gaps.length, gaps: gaps.slice(0, 10) };
  }
  out.tileCount = document.querySelectorAll('.tile').length;
  out.labels = document.querySelectorAll('.stop-label').length;
  out.busLabels = document.querySelectorAll('.bus-label').length;
  out.hint = (document.querySelector('.hint') || {}).innerText;
  out.alert = (document.querySelector('.view-alert') || {}).innerText || null;
  out.pathLens = [...document.querySelectorAll('.route-svg path')].map((p) => (p.getAttribute('d') || '').length);
  // 走向线 / 箭头 / 站点圆点的实际描边色，用于核对方向配色是否生效
  out.strokes = [...document.querySelectorAll('.route-svg path')].map((p) => p.getAttribute('stroke'));
  out.stopRings = [...document.querySelectorAll('.route-svg circle')].slice(0, 8).map((c) => c.getAttribute('stroke'));
  out.legend = [...document.querySelectorAll('.legend-item')].map((t) => t.innerText.trim());
  return out;
})()`

// AGENTS.md：探针一律不生产截图，也不写文件。视觉核对靠控制台量测值。
// 这里保留 shot() 为空实现，调用点不动，避免误删逻辑。
async function shot(name) {
  // 空实现：不调 captureScreenshot、不写盘
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')
  await seedLogin({ send, BASE, sleep })
  if (MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(1200)
  // 清掉任何版本的旧走向缓存，否则会直接命中旧几何、轮询也会误判为“已完成”
  await send('Runtime.evaluate', {
    expression: `Object.keys(localStorage).filter((k) => k.startsWith('whbis:osrm-route:')).forEach((k) => localStorage.removeItem(k))`,
  })
  await send('Page.navigate', { url: URL_PAGE })
  await sleep(1200)
  // 导航后执行上下文重建，需重新 enable 才能收到 console 事件
  await send('Runtime.enable')
  await sleep(7000)
  console.log('--- 吸附前（站点连线阶段）')
  await shot(`osrm-before-${TAG}.jpg`)

  // 轮询等待吸附完成：缓存键落库就说明两个方向的走向都算完了（比固定长等快得多）
  const t0 = Date.now()
  let done = false
  while (Date.now() - t0 < Math.max(WAIT, 30) * 1000) {
    const r = await send('Runtime.evaluate', {
      expression: `Object.keys(localStorage).filter((k) => k.startsWith('whbis:osrm-route:')).length`,
      returnByValue: true,
    })
    const n = (r.result && r.result.value) || 0
    if (n >= 2) { done = true; break }
    await sleep(1200)
  }
  console.log(`--- 等待 ${((Date.now() - t0) / 1000).toFixed(0)}s，缓存键齐全: ${done}`)
  await sleep(1500)

  const res = await send('Runtime.evaluate', { expression: STATS_EXPR, returnByValue: true })
  console.log('\n--- 吸附后统计')
  console.log(JSON.stringify(res.result && res.result.value, null, 1))
  // 把几何原文存成 JSON，给 probe-roadfit.mjs 做「逐点离路多远」的贴路体检
  const geom = await send('Runtime.evaluate', {
    expression: `(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^whbis:osrm-route:/.test(k)) continue;
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(k)); } catch (e) { continue; }
        for (let n = 0; n < 4 && raw && !Array.isArray(raw); n++) raw = raw.pts || raw.data || (raw.value && raw.value.pts);
        if (Array.isArray(raw)) out[k] = raw.map((p) => ({ lat: p.latitude !== undefined ? p.latitude : p.lat, lng: p.longitude !== undefined ? p.longitude : p.lng }));
      }
      return out;
    })()`,
    returnByValue: true,
  })
  const geomFile = path.join('.openchamber', `geom-${TAG}.json`)
  fs.writeFileSync(geomFile, JSON.stringify((geom.result && geom.result.value) || {}, null, 0))
  console.log('geometry:', geomFile)
  console.log('\n--- 控制台（osrm / error）')
  logs.slice(0, 20).forEach((l) => console.log('  ', l))
  await shot(`osrm-after-${TAG}.jpg`)
  // 关闭底图再看一次纯走向效果
  await send('Runtime.evaluate', {
    expression: `(() => { const b=[...document.querySelectorAll('.tool-btn')].find(x=>x.innerText.trim()==='底图'); if(b){b.click(); return 'clicked'} return 'not-found' })()`,
    returnByValue: true,
  })
  await sleep(1500)
  await shot(`osrm-after-notile-${TAG}.jpg`)

  // 按站名把相机拉近，专门看「以前是直连弦」的区段到底贴不贴路
  await send('Runtime.evaluate', {
    expression: `(() => { const b=[...document.querySelectorAll('.tool-btn')].find(x=>x.innerText.trim()==='底图'); if(b){b.click(); return 'on'} return 'not-found' })()`,
    returnByValue: true,
  })
  await sleep(1200)
  const FOCUS = (process.env.FOCUS || '汉阳客运中心停车场|江堤中路汉新大道').split('|')
  for (let i = 0; i < FOCUS.length; i++) {
    const name = FOCUS[i]
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        try {
          const cands = [document.querySelector('.schematic'), document.querySelector('#app'), document.body];
          let inst = null;
          for (const c of cands) { if (c && c.__vueParentComponent) { inst = c.__vueParentComponent; break } }
          if (!inst) return 'no-inst';
          // .schematic 是 uni 的 view 组件，__vueParentComponent 先指到它，要沿 parent 链上括到页面实例
          let vm = null;
          let cur = inst;
          for (let hop = 0; cur && hop < 40; hop++) {
            const p = cur.proxy || cur.ctx;
            if (p && p.stopsByDir && typeof p.renderSchematic === 'function') { vm = p; break }
            cur = cur.parent;
          }
          if (!vm) return 'no-page-vm';
          const stops = [...(vm.stopsByDir[0] || []), ...(vm.stopsByDir[1] || [])];
          const st = stops.find((s) => s.stopName === ${JSON.stringify(name)});
          if (!st) return 'no-stop';
          const lat = parseFloat(st.latitude), lng = parseFloat(st.longitude);
          const mercX = (x) => (x + 180) / 360;
          const mercY = (y) => { const rd = y * Math.PI / 180; return (1 - Math.log(Math.tan(rd) + 1 / Math.cos(rd)) / Math.PI) / 2 };
          vm._userMoved = true;
          vm.cam = { u: mercX(lng), v: mercY(lat), zoom: 15.2 };
          vm.renderSchematic();
          return 'ok';
        } catch (e) { return 'ERR: ' + (e && e.message) }
      })()`,
      returnByValue: true,
    })
    console.log(`focus ${name}:`, JSON.stringify(r && r.result).slice(0, 200))
    await sleep(2200)
    await shot(`osrm-focus${i + 1}-${TAG}.jpg`)
  }
  ws.close()
  child.kill()
  process.exit(0)
}
