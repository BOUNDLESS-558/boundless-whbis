/**
 * 首页整屏版式体检：map 页已升为首页（四视图整屏切换），逐项验渲染与布局。
 * 验五件事：
 *   ① 冷启动（清空存储）落「线路库」整屏，且列表非空 —— LineDb 在组件里必须用 created()，
 *      写成页面生命周期 onLoad 会永远不执行，列表恒空
 *   ② 选了线路后只剩一张整屏地图当底座：顶栏以裸形态长在地图控制卡 .ctrl 里，
 *      分段三档全部用全名（实时地图 / 实时线路 / 线路库），不允许 ⛶ 全屏键与独立顶栏卡
 *   ③ 发车时刻表在右侧栏里独立一张卡（.side-col > .plan-side），挂在车辆面板下方，上行与下行同屏
 *      且不共用 .panel 卡壳；自带折叠键；字号与车辆面板逐项对齐
 *   ④ 「实时线路」与「线路库」不再是整屏页面，而是浮在地图上的悬浮窗（.float-win）：
 *      开窗时地图仍在底下、窗内不再套一层玻璃卡、标题栏能拖动、✕ 收回地图
 *   ⑤ 齿轮（.ctrl-cfg）必须点得动（裸形态顶栏整行宽度铺满控卡，z-index 压不住就会吃掉点击）；
 *      主视图贴住视口底、整页无横向溢出
 *   ⑥ 悬浮窗的 📌 固定：锁定后标题栏拖动失效，再点一次恢复可拖
 * 只打控制台，不写截图 / 日志（本项目约定：探针不留产物）
 * 用法：node scripts/probe-index-mod.mjs [线路号]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9357
const PROFILE = path.join(os.tmpdir(), 'edge-index-mod')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_HOME = `${BASE}#/pages/map/map`

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
// vite 按需编译，首次进页面明显变慢：用轮询等就绪，别死等
const waitFor = async (expr, timeout = 25000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await evalV(`!!(${expr})`)) return true
    await sleep(400)
  }
  return false
}

const MEASURE = `(() => {
  const box = (n) => { if (!n) return null; const b = n.getBoundingClientRect();
    return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const q = (s) => document.querySelector(s);
  const t = (s) => { const n = q(s); return n ? n.innerText.replace(/\\s+/g, ' ').trim() : null };
  // 顶栏两种形态：独立卡（非地图视图）/ 长在地图控制卡里的裸形态（地图视图）
  const plain = q('.ctrl .mod-main.is-plain');
  const home = q('.home-top .mod-main');
  const top = plain || home;
  const stage = q('.home-stage');
  const ctrl = q('.ctrl');
  return {
    vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth,
    topBar: { box: box(top), plain: !!plain, home: !!home, brand: !!q('.brand-row'), quick: !!q('.quick-row'),
      search: !!q('.search-row'), meta: t('.vr-meta'),
      bg: top ? getComputedStyle(top).backgroundColor : null },
    tabs: [...document.querySelectorAll('.view-row .seg-tab')].map((n) => n.innerText.trim() + (n.className.includes('on') ? '★' : '·')),
    stage: { box: box(stage), cls: stage ? stage.className : null },
    db: { items: document.querySelectorAll('.db-item').length, count: t('.db-count'), matched: t('.db-lh-t'), head: t('.db-title') },
    stops: { nodes: document.querySelectorAll('.stops .node').length, badge: t('.line-badge'), pill: !!q('.mod-ctrl .refresh-pill'), ops: t('.lt-count'),
      stripCls: (() => { const n = q('.stops .mod-strip'); return n ? n.className : null })() },
    // 悬浮窗（实时线路 / 线路库）：窗壳只有一张，内容平铺在窗体里
    win: { box: box(q('.float-win')), ready: !!q('.float-win.ready'), title: t('.float-win .fw-title'),
      pin: !!q('.float-win .fw-pin'), pinOn: !!q('.float-win .fw-pin.on'),
      close: !!q('.float-win .fw-close'), head: box(q('.float-win .fw-head')), body: box(q('.float-win .fw-body')),
      hasStops: !!q('.float-win .stops'), hasDb: !!q('.float-win .db-mod'),
      // 窗内的卡壳必须是透明的（plain 生效）：取到“背景 + 上边框宽”两个值就够判定
      shell: (() => { const n = q('.float-win .stops .mod') || q('.float-win .db-mod'); if (!n) return null;
        const cs = getComputedStyle(n); return cs.backgroundColor + '/' + cs.borderTopWidth })(),
      // 窗口自己不能越出视口，也不能吃掉整屏（地图得露出来）
      clipped: (() => { const n = q('.float-win'); if (!n) return null; const r = n.getBoundingClientRect();
        return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 })(),
      // 齿轮能不能点：取齿轮中心的命中元素
      gearHit: (() => { const g = q('.ctrl-cfg'); if (!g) return null; const r = g.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit ? (g.contains(hit) || hit === g ? 'gear' : hit.className || 'other') : null })() },
    plan: { rows: document.querySelectorAll('.plan-row').length, dir: t('.ph-title') + ' ' + t('.pg-dir'), head: t('.ph-count'), first: t('.plan-time'), empty: t('.plan-empty') },
    map: { page: !!q('.lmap-page'), ctrl: box(ctrl), side: box(q('.side-col')), panel: box(q('.panel')), fsBtn: !!q('.fs-btn'),
      inCtrl: !!plain, dirTabs: [...document.querySelectorAll('.ctrl-dir .dir-tab')].map((n) => n.innerText.trim()).join('/'),
      // 时刻表要是右侧栏里独立一张卡（.plan-side），长在车辆面板下方，不得共用 .panel 卡壳
      planBox: box(q('.side-col > .plan-side')), planInsidePanel: !!q('.panel .plan-side'),
      planTitle: t('.side-col .ph-title'),
      planRows: document.querySelectorAll('.side-col .plan-row').length,
      planEmpty: !!q('.side-col .plan-empty'),
      // 上行与下行同屏：两个 .plan-group，各带一枚方向徽标与自己的班次计数
      planGroups: document.querySelectorAll('.side-col .plan-group').length,
      planDirTabs: [...document.querySelectorAll('.side-col .pg-dir')].map((n) => n.innerText.trim()).join('/'),
      planGroupCounts: [...document.querySelectorAll('.side-col .pg-count')].map((n) => n.innerText.trim()).join(' '),
      planRowsByDir: [...document.querySelectorAll('.side-col .plan-group')].map((g) => g.querySelectorAll('.plan-row').length).join('/'),
      planCount: t('.side-col .ph-count'),
      // 折叠键与两张面板的字号对帐（车辆面板 vs 时刻表面板必须同一套）
      foldBtn: !!q('.side-col .ph-fold'), bodyBox: box(q('.side-col .plan-body')),
      fs: (() => { const g = (s) => { const n = q(s); return n ? getComputedStyle(n).fontSize : null }; return {
        panelTitle: g('.panel-title'), planTitle: g('.side-col .ph-title'),
        busOrg: g('.bus-item .bus-org'), planTime: g('.side-col .plan-time'),
        busSub: g('.bus-item .bus-speed'), planOrg: g('.side-col .plan-org'),
        busDir: g('.bus-item .bus-dir'), planDir: g('.side-col .pg-dir'),
        foldBtn: q('.side-col .ph-fold') ? getComputedStyle(q('.side-col .ph-fold')).width : null,
        collapseBtn: q('.collapse-btn') ? getComputedStyle(q('.collapse-btn')).width : null, } })(),
      planScroll: (() => { const n = q('.side-col .plan-side'); return n ? n.scrollHeight - n.clientHeight : null })() },
  };
})()`

// 视图分段 tab：全名与短名都认（现在地图内外都用全名，保留短名只为了容错）
const clickTab = (full, short) => evalV(`(() => {
  const want = ['${full}', '${short}'];
  const n = [...document.querySelectorAll('.view-row .seg-tab')].find((x) => want.includes(x.innerText.trim()));
  if (!n) return 'not-found';
  n.click();
  return n.innerText.trim();
})()`) 

// 窗内卡壳“拆干净”的判据：背景全透 + 上边框 0（.stops.plain .mod / .db-mod.plain）
const SHELL_NONE = /^rgba\(0, 0, 0, 0\)\/0px$/

// 用真鼠标拖一下标题栏：验证 mousedown 原生监听挂上了（uni H5 对 view 的 mouse 事件绑定不可靠）
const dragHeadBy = async (dx, dy) => {
  const p = await evalV(`(() => { const n = document.querySelector('.float-win .fw-head'); if (!n) return null;
    const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (!p) return false
  const ev = (type, x, y, down) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: down ? 1 : 0, clickCount: type === 'mousePressed' ? 1 : 0 })
  await ev('mouseMoved', p.x, p.y, false)
  await ev('mousePressed', p.x, p.y, true)
  await ev('mouseMoved', p.x + dx / 2, p.y + dy / 2, true)
  await ev('mouseMoved', p.x + dx, p.y + dy, true)
  await ev('mouseReleased', p.x + dx, p.y + dy, false)
  await sleep(250)
  return true
}

// 窄屏下窗宽几乎等于视口宽，横向会被 clampX 夹住；按与组件同款的限幅公式算“应该落在哪”，
// 而不是直接拿 dx 当位移（否则 390 屏上“拖不动”是假失败）
const expectPos = (m, from, dx, dy) => {
  if (!from) return null
  const vw = m.vw
  const vh = m.vh
  const x = Math.min(Math.max(from.l + dx, 6), Math.max(6, vw - from.w - 6))
  const y = Math.min(Math.max(from.t + dy, 6), Math.max(6, vh - from.h - 6))
  return { x, y }
}

const fails = []
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' | ' + extra : ''}`)
  if (!ok) fails.push(label)
}
// 字号对帐：两边任一侧取不到（无在线车 / 面板未渲染）就只报不判
const sameFs = (a, b, label, extra = '') => {
  if (a == null || b == null) { console.log(`· ${label} 不判定（${a == null ? '缺' : a} / ${b == null ? '缺' : b}）`); return }
  check(a === b, label, `${extra} ${a} vs ${b}`)
}

// 通用布局判定：每个视图都要过
const layout = (m, tag) => {
  console.log(`\n---- ${tag}：顶栏 ${m.topBar.box ? m.topBar.box.w + '×' + m.topBar.box.h : '无'} / 分段 ${m.tabs.join(' ')} ----`)
  check(!!m.topBar.box, '顶栏存在（.mod-main）')
  check(!!m.topBar.search, '顶栏含搜索行')
  check(!!m.stage.box, '主视图容器存在（.home-stage）')
  if (m.stage.box && m.topBar.box) {
    if (m.topBar.plain) {
      // 地图视图：顶栏长在控制卡里，本来就是浮在整屏地图之上，只验它没越出主视图
      check(m.topBar.box.t >= m.stage.box.t - 1 && m.topBar.box.b <= m.stage.box.b + 1,
        '顶栏（裸形态）落在主视图范围内', `top=${m.topBar.box.t}~${m.topBar.box.b} stage=${m.stage.box.t}~${m.stage.box.b}`)
    } else {
      check(m.stage.box.t >= m.topBar.box.b - 1, '主视图不压在顶栏上', `stage.t=${m.stage.box.t} top.b=${m.topBar.box.b}`)
    }
    check(Math.abs(m.stage.box.b - m.vh) <= 2, '主视图贴住视口底', `stage.b=${m.stage.box.b} vh=${m.vh}`)
    check(m.stage.box.h > m.vh * 0.5, '主视图吃掉大部分视口', `h=${m.stage.box.h}`)
  }
  check(m.scrollW <= m.vw + 1, '整页无横向溢出', `scrollW=${m.scrollW} vw=${m.vw}`)
}

ws.onopen = async () => {
  await send('Page.enable')
  await send('Runtime.enable')

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop', mobile: false }, { w: 390, h: 844, tag: 'mobile', mobile: true }]) {
    console.log(`\n======== ${vp.tag} ${vp.w}x${vp.h} ========`)
    // ① 冷启动：清掉存储再重载，保证「从未选过线路」的初始态（home-line 记忆会改变落点）
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(300)
    await send('Page.navigate', { url: URL_HOME })
    await waitFor('window.uni && document.querySelector(".mod-main")')
    await evalV(`localStorage.removeItem('whbis:home-line'); localStorage.removeItem('whbis:line-refresh-sec'); location.reload()`)
    await waitFor(`document.querySelector('.db-item')`)

    const cold = await evalV(MEASURE)
    layout(cold, '① 冷启动 → 线路库')
    check(cold.topBar.brand, '未选线路时品牌行在')
    check(!!cold.topBar.quick, '未选线路时快捷行在')
    check(cold.db.items > 0, '线路库列表非空（组件内必须 created() 取数）', `db-item=${cold.db.items} 头=${cold.db.count} ${cold.db.matched}`)
    check(!!cold.stage.cls && cold.stage.cls.includes('stage-db'), '分段高亮落在线路库', cold.stage.cls)

    // ② 快捷选线 → 直接落地图视图，顶栏转紧凑态；等时刻表出内容再量测
    const clicked = await evalV(`(() => { const n = [...document.querySelectorAll('.quick-tag')].find(e => e.innerText.trim() === '${LINE_NO}'); if (!n) return false; n.click(); return true })()`)
    check(clicked, `点快捷胶囊「${LINE_NO}」`)
    await waitFor(`!!document.querySelector('.lmap-page') && !!document.querySelector('.ctrl-dir')`)
    await waitFor(`!!document.querySelector('.side-col .plan-row') || !!document.querySelector('.side-col .plan-empty')`)
    await sleep(1500)
    const mp = await evalV(MEASURE)
    layout(mp, '② 实时地图（默认主视图）')
    check(mp.map.page, '地图视图渲染（.lmap-page）')
    check(!!mp.map.ctrl, '地图控制卡在内（.ctrl）', mp.map.ctrl ? `${mp.map.ctrl.w}×${mp.map.ctrl.h}` : 'null')
    check(!mp.map.fsBtn, '⛶ 全屏键已收起（地图已整屏铺满）')
    check(mp.topBar.plain && mp.map.inCtrl, '顶栏以裸形态长在 .ctrl 内', mp.topBar.plain ? 'plain' : '仍是独立卡')
    check(!mp.topBar.brand, '选线后顶栏转紧凑态（品牌行收起）')
    check(mp.map.dirTabs === '全部/上行/下行', '方向三键在控制卡内', mp.map.dirTabs)
    check(mp.tabs.length === 3 && !mp.tabs.some((x) => x.includes('时刻表')), '分段只剩三档（时刻表已并入地图）', mp.tabs.join(' '))
    if (mp.map.ctrl && mp.stage.box) {
      check(mp.map.ctrl.t >= mp.stage.box.t - 1 && mp.map.ctrl.b <= mp.stage.box.b + 1, '控制卡落在主视图内', `ctrl.t=${mp.map.ctrl.t} stage=${mp.stage.box.t}~${mp.stage.box.b}`)
    }

    // ③ 发车时刻表：右侧栏里独立一张卡，挂在实时车辆面板下方（不共用面板壳）
    check(!!mp.map.panel, '实时车辆面板在（.panel）', mp.map.panel ? `${mp.map.panel.w}×${mp.map.panel.h}` : 'null')
    check(!!mp.map.planBox, '时刻表独立卡在右侧栏（.side-col > .plan-side）', mp.map.planBox ? `${mp.map.planBox.w}×${mp.map.planBox.h}` : 'null')
    check(!mp.map.planInsidePanel, '时刻表不共用车辆面板卡壳（.panel 内无 .plan-side）')
    if (mp.map.planBox && mp.map.panel) {
      check(mp.map.planBox.t >= mp.map.panel.b - 1, '时刻表卡在车辆面板下方', `plan.t=${mp.map.planBox.t} panel.b=${mp.map.panel.b}`)
      check(Math.abs(mp.map.planBox.l - mp.map.panel.l) <= 1 && Math.abs(mp.map.planBox.r - mp.map.panel.r) <= 1, '与车辆面板同宽对齐', `plan.l=${mp.map.planBox.l} panel.l=${mp.map.panel.l}`)
    }
    if (mp.map.side && mp.stage.box) {
      check(mp.map.side.t >= mp.stage.box.t - 1 && mp.map.side.b <= mp.stage.box.b + 1, '右侧栏没顶出主视图', `side=${mp.map.side.t}~${mp.map.side.b} stage=${mp.stage.box.t}~${mp.stage.box.b}`)
    }
    check(mp.map.planRows > 0 || mp.map.planEmpty, '时刻表出内容（班次行或空态）', `plan-row=${mp.map.planRows} 空态=${mp.map.planEmpty} 头=「${mp.map.planTitle} ${mp.map.planCount}」`)
    // 双方向同屏：两组各带方向徽标，「上行」「下行」必须同时出现，缺一组就是又退回单方向
    check(mp.map.planGroups === 2, '时刻表两组同屏（上行 + 下行）', `plan-group=${mp.map.planGroups} 徽标=${mp.map.planDirTabs}`)
    check(mp.map.planDirTabs === '上行/下行', '方向徽标齐且顺序为上/下', mp.map.planDirTabs)
    console.log(`· 两方向班次：合计「${mp.map.planCount}」分组「${mp.map.planGroupCounts}」各组行=${mp.map.planRowsByDir}`)
    if (mp.map.planBox) {
      check(mp.map.planBox.h <= mp.vh * 0.4, '时刻表卡不撞视口（列表自己滚）', `h=${mp.map.planBox.h} vh=${mp.vh} 溢出=${mp.map.planScroll}px`)
    }
    // 字号：两张面板必须用同一套（标题 / 主数据 / 次要 / 方向徽标 / 折叠键）
    const fs = mp.map.fs || {}
    sameFs(fs.panelTitle, fs.planTitle, '标题字号两面板一致')
    sameFs(fs.busOrg, fs.planTime, '主数据字号一致（自编号 / 发车时间）')
    sameFs(fs.busSub, fs.planOrg, '次要字号一致（车速 / 车辆）')
    sameFs(fs.busDir, fs.planDir, '方向徽标字号一致')
    sameFs(fs.collapseBtn, fs.foldBtn, '折叠键尺寸一致')

    // 时刻表卡的折叠 / 展开（与车辆面板同款语义：只收列表，标题行常驻）
    check(mp.map.foldBtn, '时刻表卡自带折叠键（.ph-fold）')
    await evalV(`(() => { const b = document.querySelector('.side-col .ph-fold'); if (b) b.click(); return !!b })()`)
    await sleep(400)
    const folded = await evalV(`(() => { const n = document.querySelector('.side-col .plan-body'); return n ? getComputedStyle(n).display : 'absent' })()`)
    const foldH = await evalV(`(() => { const n = document.querySelector('.side-col .plan-side'); return n ? Math.round(n.getBoundingClientRect().height) : null })()`)
    check(folded === 'none', '点折叠后班次列表收起', `display=${folded} 卡高=${foldH}px`)
    await evalV(`(() => { const b = document.querySelector('.side-col .ph-fold'); if (b) b.click(); return !!b })()`)
    await sleep(400)
    const unfolded = await evalV(`(() => { const n = document.querySelector('.side-col .plan-body'); return n ? getComputedStyle(n).display : 'absent' })()`)
    check(unfolded !== 'none' && unfolded !== 'absent', '再点一次展开', `display=${unfolded}`)

    // ④ 齿轮必须点得动：裸形态顶栏整行铺满控卡，齿轮被压在下面就永远收不到点击
    check(mp.win.gearHit === 'gear', '齿轮（.ctrl-cfg）在最上层可点', `命中=${mp.win.gearHit}`)
    await evalV(`(() => { const g = document.querySelector('.ctrl-cfg'); if (g) g.click(); return !!g })()`)
    await sleep(600)
    const drawer = await evalV(`!!document.querySelector('.sd-panel')`)
    check(drawer, '点齿轮开出设置抽屉', `抽屉=${drawer}`)
    await evalV(`(() => { const c = document.querySelector('.sd-close') || document.querySelector('.sd-mask'); if (c) c.click(); return !!c })()`)
    await sleep(500)
    check(!(await evalV(`!!document.querySelector('.sd-panel')`)), '抽屉可关闭', '')

    // ⑤ 实时线路：不再整屏换页，而是浮在地图上的一扇窗
    const tStops = await clickTab('实时线路', '线路')
    check(tStops !== 'not-found', '点分段「实时线路」', String(tStops))
    await waitFor(`!!document.querySelector('.float-win .stops .node')`)
    await sleep(800)
    const st = await evalV(MEASURE)
    layout(st, '④ 实时线路（地图上的悬浮窗）')
    check(st.map.page, '开窗时地图仍在底下（不是整屏换页）')
    check(!!st.win.box && st.win.ready, '悬浮窗已定位（.float-win.ready）', st.win.box ? `${st.win.box.w}×${st.win.box.h}` : 'null')
    check(st.win.hasStops && !st.win.hasDb, '窗内是线路内容', `stops=${st.win.hasStops} db=${st.win.hasDb}`)
    check(st.stops.nodes > 0, '窗内线路带站点渲染', `.node=${st.stops.nodes} ${st.stops.ops}`)
    check(SHELL_NONE.test(String(st.win.shell)), '窗内不再套第二层玻璃卡（plain 生效）', String(st.win.shell))
    check(!st.win.clipped, '窗口完整落在视口内', st.win.box ? `${st.win.box.l},${st.win.box.t} ~ ${st.win.box.r},${st.win.box.b}` : 'null')
    if (st.win.box) check(Number(st.win.box.h) <= st.vh * 0.85, '窗口没吃掉整屏（地图还露得出来）', `h=${st.win.box.h} vh=${st.vh}`)
    check(st.win.close, '窗带 ✕')
    check(st.win.pin, '窗带 📌 固定键')
    check(String(st.stops.badge).replace(/\s/g, '') === `${LINE_NO}路` || String(st.stops.badge).trim() === LINE_NO, '线路徽标为当前线路', String(st.stops.badge))
    check(st.stops.pill, '刷新胶囊在窗内控制行')

    // 拖动标题栏：整窗跟随（验 mousedown 原生监听真的挂上了）
    const b0 = st.win.box
    const dragged = await dragHeadBy(90, -70)
    const m1 = await evalV(MEASURE)
    const b1 = m1.win.box
    const w0 = expectPos(m1, b0, 90, -70)
    check(dragged && b1 && w0 && Math.abs(b1.l - w0.x) <= 2 && Math.abs(b1.t - w0.y) <= 2,
      '按住标题栏可拖动窗口', b1 && w0 ? `${b0.l},${b0.t} → ${b1.l},${b1.t}（应收敛到 ${w0.x.toFixed(1)},${w0.y.toFixed(1)}）` : 'null')

    // 📌 固定：锁住之后标题栏不再响应拖动；再点一次解锁又能拖
    await evalV(`(() => { const b = document.querySelector('.float-win .fw-pin'); if (b) b.click(); return !!b })()`)
    await sleep(300)
    const pinned = await evalV(MEASURE)
    check(pinned.win.pinOn, '点 📌 后进入固定态（按钮高亮）', `on=${pinned.win.pinOn}`)
    const bp = pinned.win.box
    await dragHeadBy(80, 60)
    const bp2 = (await evalV(MEASURE)).win.box
    check(bp2 && Math.abs(bp2.l - bp.l) <= 2 && Math.abs(bp2.t - bp.t) <= 2, '固定后拖动无效（位置锁定）', bp2 ? `${bp.l},${bp.t} → ${bp2.l},${bp2.t}` : 'null')
    await evalV(`(() => { const b = document.querySelector('.float-win .fw-pin'); if (b) b.click(); return !!b })()`)
    await sleep(300)
    await dragHeadBy(-60, -40)
    const m3 = await evalV(MEASURE)
    const bp3 = m3.win.box
    const w3 = expectPos(m3, bp2, -60, -40)
    check(bp3 && w3 && Math.abs(bp3.l - w3.x) <= 2 && Math.abs(bp3.t - w3.y) <= 2, '解锁后恢复可拖', bp3 && w3 ? `${bp2.l},${bp2.t} → ${bp3.l},${bp3.t}（应收敛到 ${w3.x.toFixed(1)},${w3.y.toFixed(1)}）` : 'null')

    // 窗内切方向：线路带必须换成下行玫红（方向在窗内自己生效，不再靠顶栏文案回显）
    await evalV(`(() => { const t=[...document.querySelectorAll('.float-win .mod-ctrl .seg-tab')].find(n=>n.innerText.includes('下行')); if(t){t.click(); return 'ok'} return 'not-found' })()`)
    await sleep(1200)
    const sd = await evalV(MEASURE)
    check(!!sd.stops.stripCls && /dir-down/.test(sd.stops.stripCls), '窗内切下行：线路带换色', String(sd.stops.stripCls))

    // ✕ 收窗 → 回到纯地图
    await evalV(`(() => { const b = document.querySelector('.float-win .fw-close'); if (b) b.click(); return !!b })()`)
    await sleep(600)
    const closed = await evalV(MEASURE)
    check(!closed.win.box, '点 ✕ 收回悬浮窗', `tabs=${closed.tabs.join(' ')}`)
    check(closed.map.page && closed.topBar.plain, '收回后地图与裸形态顶栏仍在')

    // ⑥ 线路库：同样开一扇窗；再点一次分段收回（视图来回切换不留残留遮罩）
    const tDb = await clickTab('线路库', '线路库')
    check(tDb !== 'not-found', '点分段「线路库」', String(tDb))
    await waitFor(`!!document.querySelector('.float-win .db-item')`)
    await sleep(600)
    const back = await evalV(MEASURE)
    layout(back, '⑤ 线路库（地图上的悬浮窗）')
    check(back.map.page, '开窗时地图仍在底下')
    check(back.win.hasDb && back.db.items > 0, '窗内线路库列表非空', `db-item=${back.db.items} ${back.db.matched}`)
    check(SHELL_NONE.test(String(back.win.shell)), '窗内不再套第二层玻璃卡（plain 生效）', String(back.win.shell))
    await clickTab('线路库', '线路库')
    await sleep(600)
    const closed2 = await evalV(MEASURE)
    check(!closed2.win.box && closed2.tabs.join(' ').includes('实时地图★'), '再点一次分段收回窗口', closed2.tabs.join(' '))
    const residue = await evalV(`!!document.querySelector('.rm-mask') || !!document.querySelector('.db-mask')`)
    check(!residue, '无残留遮罩', String(residue))
  }

  console.log(`\n==== 结论 ====`)
  console.log(fails.length ? 'FAIL: ' + fails.join(' , ') : 'ALL PASS')
  ws.close(); child.kill(); process.exit(fails.length ? 1 : 0)
}
