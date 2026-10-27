/**
 * 左上角控制卡版式体检（整卡包裹 + 方向行）。验四件事：
 *   ① 四块内容（搜索 / 主操作 / 方向 / 视图）确实落在同一张卡片里，左缘对齐、不溢出
 *   ② 徽标在线路号**同一行**且紧跟在它后面（不是第二排、不被 margin-left:auto 甩到最右）
 *   ③ 全部/上行/下行 三个 tab 文字**水平 + 垂直都居中**；循环切换键 ⇄ 紧贴在 tab 右侧
 *   ④ 竖屏窄屏（390 / 360 / 320）下公司名宁可省略号，也不许换行 / 溢出
 * 额外：首页地图视图的顶栏（LineSearch plain）必须**长在 .ctrl 里**（视图分段 + 搜索行是卡内首块），
 * 独立顶栏 .home-top 与 ⛶ 全屏键都不该再出现；非地图视图才用独立顶栏卡
 * 只打控制台，不写截图 / 日志（本项目约定：探针不留产物）
 * 用法：node scripts/probe-ctrl-row.mjs [线路号]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { seedLogin } from './probe-auth.mjs'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9344
const PROFILE = path.join(process.env.TMP || '.', 'edge-ctrl-prof')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(PROFILE, { recursive: true, force: true })

const URL_PAGE = `${BASE}#/pages/map/map?view=map&lineCode=420100-${LINE_NO}-0&direction=0&lineName=${encodeURIComponent(LINE_NO)}`

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
  return null // 不出图，保留调用点位便于临时排查
}

// 量：卡片 / 四块内容 / tab 盒 / tab 文字盒 / 方向行 / 线路号 / 徽标，全部换算成屏幕 px
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
  const card = document.querySelector('.ctrl');
  // 顶栏：地图视图下是 .ctrl 里的裸形态（is-plain），其余视图才是独立卡 .home-top .mod-main
  const plainTop = document.querySelector('.ctrl .mod-main.is-plain');
  const homeTop = document.querySelector('.home-top .mod-main');
  const topBarEl = plainTop || homeTop;
  const stage = document.querySelector('.home-stage');
  const cs = card ? getComputedStyle(card) : null;
  // 卡内内容块（按期望的视觉顺序声明，缺项自动跳过）
  const SPECS = [
    { name: 'plain-view', sel: '.ctrl .mod-main.is-plain .view-row' },
    { name: 'plain-search', sel: '.ctrl .mod-main.is-plain .search-row' },
    { name: 'ctrl-search', sel: '.ctrl .ctrl-search' },
    { name: 'ctrl-tools', sel: '.ctrl .ctrl-tools' },
    { name: 'ctrl-dir', sel: '.ctrl .ctrl-dir' },
    { name: 'ctrl-view', sel: '.ctrl .ctrl-view' },
  ];
  const blocks = SPECS
    .map((s) => ({ name: s.name, box: document.querySelector(s.sel) }))
    .filter((x) => x.box)
    .map((x) => ({ name: x.name, box: r(x.box) }));
  // 并入卡内的视图分段：四枚 tab 不得换行 / 溢出，且文字要在 tab 内居中
  const vtabs = [...document.querySelectorAll('.ctrl .mod-main.is-plain .view-row .seg-tab')].map((n) => ({ text: n.innerText.trim(), box: r(n), txt: textBox(n), on: n.classList.contains('on') }));
  const vrow = document.querySelector('.ctrl .mod-main.is-plain .view-row');
  const cfg = document.querySelector('.ctrl .ctrl-cfg');
  const topBar = topBarEl ? {
    box: r(topBarEl),
    bg: getComputedStyle(topBarEl).backgroundColor,
    plain: !!plainTop,
    hasViewRow: !!topBarEl.querySelector('.view-row'),
    hasSearch: !!topBarEl.querySelector('.search-row'),
    hasGear: !!topBarEl.querySelector('.ab-gear'),
    hasMeta: !!topBarEl.querySelector('.vr-meta'),
    compact: !topBarEl.querySelector('.brand-row'),
    overflow: topBarEl.scrollWidth > topBarEl.clientWidth + 1,
  } : null;
  const tabs = [...dir.querySelectorAll('.dir-tab')].map((n) => ({ text: n.innerText.trim(), box: r(n), txt: textBox(n), active: n.classList.contains('active') }));
  const cur = dir.querySelector('.dir-cur');
  const swap = dir.querySelector('.dir-swap');
  const org = dir.querySelector('.ctrl-org');
  const tag = dir.querySelector('.org-tag');
  const name = dir.querySelector('.org-name');
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    rpx: +(document.documentElement.clientWidth / 750).toFixed(3),
    card: card ? { box: r(card), bg: cs.backgroundColor, radius: cs.borderRadius, border: cs.borderTopWidth, overflow: card.scrollHeight > card.clientHeight + 1 } : null,
    blocks,
    topBar,
    homeTopBox: homeTop ? r(homeTop) : null,
    vtabs,
    vrow: vrow ? { box: r(vrow), overflow: vrow.scrollWidth > vrow.clientWidth + 1 } : null,
    cfg: cfg ? r(cfg) : null,
    dirPadCfg: dir.className.includes('pad-cfg'),
    fsBtn: !!document.querySelector('.fs-btn'),
    stage: stage ? r(stage) : null,
    // 主操作行（现在只剩一键查询）：应当独占整行
    tools: [...document.querySelectorAll('.ctrl-tools .tool-btn')].map((n) => ({ text: n.innerText.replace(/\\s+/g, ' ').trim().slice(0, 10), box: r(n) })),
    // 方向切换键（从主操作行挪进方向行）
    swap: swap ? { box: r(swap), txt: textBox(swap), cls: swap.className } : null,
    // 旧的操作说明文字应该已经移除
    hasHint: !!document.querySelector('.view-hint'),
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
  // ① 整卡包裹：背景/圆角/描边齐备，四块内容都落卡内且左缘对齐（说明它们是一个整体，不是漂浮的胶囊）
  if (m.card) {
    const opaque = m.card.bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(m.card.bg)
    out.push(`卡片包裹 ${m.card.box.w}×${m.card.box.h}px 背景=${m.card.bg} 圆角=${m.card.radius} 描边=${m.card.border} ${opaque && parseFloat(m.card.radius) > 0 ? '✓' : '✗'}`)
    const inside = m.blocks.every((b) => b.box.l >= m.card.box.l - 1 && b.box.r <= m.card.box.r + 1)
    const lefts = m.blocks.map((b) => b.box.l)
    const aligned = lefts.length > 1 && Math.max(...lefts) - Math.min(...lefts) <= 1.5
    out.push(`卡内内容块（${m.blocks.map((b) => b.name).join(' / ')}）卡内=${inside ? '✓' : '✗'} 左缘对齐=${aligned ? '✓' : '✗ spread=' + (Math.max(...lefts) - Math.min(...lefts)).toFixed(1)}`)
    out.push(`卡片横向溢出=${m.card.overflow ? '✗ 有' : '✓ 无'}`)
    // 区块顺序（按声明的期望顺序取存在的项）：视图分段 → 搜索 → 方向 → 视图工具
    const order = m.blocks.map((b) => b.box.t)
    const ordered = order.every((v, i) => i === 0 || v > order[i - 1])
    out.push(`区块顺序 ${m.blocks.map((b) => b.name).join('→')} ${ordered ? '✓' : '✗ ' + order.join(' / ')}`)
    out.push(`已移除说明文字（.view-hint）=${m.hasHint ? '✗ 仍在' : '✓'}`)
  } else out.push('✗ 没找到 .ctrl 卡片')
  // 顶栏：地图视图下应为 .ctrl 内的裸形态（无卡壳、无重复齿轮/状态文案），不得再有独立顶栏
  if (m.topBar) {
    const inCard = m.card
      ? m.topBar.box.l >= m.card.box.l - 1 && m.topBar.box.r <= m.card.box.r + 1 &&
        m.topBar.box.t >= m.card.box.t - 1 && m.topBar.box.b <= m.card.box.b + 1
      : false
    out.push(`顶栏 ${m.topBar.box.w}×${m.topBar.box.h}px 形态=${m.topBar.plain ? '裸（并入地图控制卡）' : '独立卡'} 分段=${m.topBar.hasViewRow ? '✓' : '✗'} 搜索行=${m.topBar.hasSearch ? '✓' : '✗'}`)
    if (m.topBar.plain) {
      const noBg = /rgba\(0, 0, 0, 0\)|transparent/.test(m.topBar.bg)
      out.push(`  在 .ctrl 内=${inCard ? '✓' : '✗'} 自带卡壳=${noBg ? '✓ 已去掉' : '✗ 仍有背景 ' + m.topBar.bg} 重复齿轮=${m.topBar.hasGear ? '✗ 仍在' : '✓'} 重复状态文案=${m.topBar.hasMeta ? '✗ 仍在' : '✓'}`)
      out.push(`  自身横向溢出=${m.topBar.overflow ? '✗ 有' : '✓ 无'}（卡宽 ${m.card ? m.card.box.w : '?'}px）`)
      if (m.vtabs.length) {
        const spread = Math.max(...m.vtabs.map((t) => t.box.cy || 0)) - Math.min(...m.vtabs.map((t) => t.box.cy || 0))
        out.push(`  视图分段 ${m.vtabs.length} 枚「${m.vtabs.map((t) => t.text + (t.on ? '★' : '')).join(' / ')}」单行 spread=${spread.toFixed(1)}px ${spread < 1.5 && !m.vrow.overflow ? '✓' : '✗ 换行/溢出'}`)
        for (const t of m.vtabs) {
          const dx = t.txt ? +(t.txt.cx - t.box.cx).toFixed(1) : null
          const dy = t.txt ? +(t.txt.cy - t.box.cy).toFixed(1) : null
          out.push(`    「${t.text}」盒 ${t.box.w}×${t.box.h} 文字偏移 dx=${dx} dy=${dy} ${Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5 ? '✓' : '✗'}`)
        }
      } else out.push('✗ 卡内没找到视图分段 tab')
      // 齿轮只保留 .ctrl-cfg 一个：它盖在第一行右端，第一行必须让位
      if (m.cfg && m.vrow) {
        const clear = m.vrow.box.r - m.cfg.l
        out.push(`  首行与齿轮：让位 ${clear.toFixed(1)}px ${clear >= 0 ? '✓' : '✗ tab 钻到齿轮底下'}`)
      }
      out.push(`  方向行不再让位齿轮（pad-cfg）=${m.dirPadCfg ? '✗ 仍在让位，浪费行宽' : '✓'}`)
      out.push(`  ⛶ 全屏键=${m.fsBtn ? '✗ 仍在（地图已整屏铺满，该收起）' : '✓ 已收起'}`)
    }
    if (m.homeTopBox) out.push(`✗ 地图视图下仍有独立顶栏卡 .home-top（${m.homeTopBox.w}×${m.homeTopBox.h}）`)
  } else out.push('✗ 没找到顶栏 .mod-main')
  if (m.stage) out.push(`主视图容器 ${m.stage.w}×${m.stage.h}px（视口高 ${m.vh}）`)
  // 主操作行：独立页形态应只剩一键查询并撑满内容宽；嵌入态该块不存在 → 跳过
  if (m.tools && m.tools.length === 1) {
    const a = m.tools[0]
    const diff = +(a.box.w - m.dir.w).toFixed(1)
    out.push(`主操作「${a.text}」${a.box.w}px / 方向行宽 ${m.dir.w}px 独占整行=${Math.abs(diff) <= 2 ? '✓' : '✗ 差 ' + diff + 'px'}`)
  } else if (m.tools && m.tools.length > 1) out.push(`✗ 主操作行还有 ${m.tools.length} 枚按钮（应只剩一键查询）`)
  else out.push('.ctrl-tools 不存在（搜索 / 查询已上移到首页顶栏）— 跳过主操作行断言')
  // 方向切换键：应在方向行内、与 tab 同行、紧贴右侧，图标居中
  if (m.swap) {
    const lastTab = m.tabs[m.tabs.length - 1]
    const inRow = Math.abs(m.swap.box.cy - lastTab.box.cy) < 1.5
    const gap = +(m.swap.box.l - lastTab.box.r).toFixed(1)
    const dx = m.swap.txt ? +(m.swap.txt.cx - m.swap.box.cx).toFixed(1) : null
    const dy = m.swap.txt ? +(m.swap.txt.cy - m.swap.box.cy).toFixed(1) : null
    out.push(`方向切换键 ⇄ ${m.swap.box.w}×${m.swap.box.h}px 行内=${inRow ? '✓' : '✗'} 距「${lastTab.text}」${gap}px ${gap >= 0 && gap <= 12 ? '✓' : '✗（应 0~12，紧贴）'} 图标居中 dx=${dx} dy=${dy} ${Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5 ? '✓' : '✗'}`)
    out.push(`  当前视角着色 class=${m.swap.cls}（d2 全部 / d0 上行 / d1 下行）`)
  } else out.push('✗ 方向行里没有 .dir-swap（切换方向按钮丢了）')
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
  await seedLogin({ send, evalV, BASE, sleep })

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop', mobile: false }, { w: 390, h: 844, tag: 'mobile', mobile: true }, { w: 360, h: 780, tag: 'narrow360', mobile: true }, { w: 320, h: 700, tag: 'narrow320', mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile })
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Page.navigate', { url: URL_PAGE })
    await sleep(vp === 0 ? 9000 : 8000)
    const m = await evalV(MEASURE)
    console.log(`\n==== ${vp.tag} ${vp.w}x${vp.h}（实测视口 ${m && m.vw}px）====`)
    for (const line of judge(m)) console.log(line)
    // 交互：点一次 ⇄，「全部」→「上行」（着色类从 d2 变 d0，对应 tab 同时高亮）
    if (vp.tag === 'desktop') {
      const before = await evalV(`(() => { const s = document.querySelector('.dir-swap'); return s ? s.className : null })()`)
      await evalV(`document.querySelector('.dir-swap').click()`)
      await sleep(900)
      const after = await evalV(`(() => {
        const s = document.querySelector('.dir-swap');
        const tabs = [...document.querySelectorAll('.dir-tab')].map((n) => n.innerText.trim() + (n.classList.contains('active') ? '★' : ''));
        return { cls: s.className, tabs: tabs.join(' ') };
      })()`)
      const ok = !!(after && /d0/.test(after.cls) && /上行★/.test(after.tabs))
      console.log(`点击 ⇄：${before} → ${after && after.cls} / tabs=${after && after.tabs} ${ok ? '✓' : '✗'}`)
    }
  }

  ws.close(); child.kill(); process.exit(0)
}
