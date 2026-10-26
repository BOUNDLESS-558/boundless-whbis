/**
 * 左上角控制卡版式体检（整卡包裹 + 方向行）。验四件事：
 *   ① 四块内容（搜索 / 主操作 / 方向 / 视图）确实落在同一张卡片里，左缘对齐、不溢出
 *   ② 徽标在线路号**同一行**且紧跟在它后面（不是第二排、不被 margin-left:auto 甩到最右）
 *   ③ 全部/上行/下行 三个 tab 文字**水平 + 垂直都居中**；循环切换键 ⇄ 紧贴在 tab 右侧
 *   ④ 竖屏窄屏（390 / 360 / 320）下公司名宁可省略号，也不许换行 / 溢出
 * 额外：主操作行只剩「一键查询」并独占整行（切换方向已移进方向行），点 ⇄ 着色与 tab 同步
 * 只打控制台，不写截图 / 日志（本项目约定：探针不留产物）
 * 用法：node scripts/probe-ctrl-row.mjs [线路号]
 * 依赖：先 npm run dev:h5
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LINE_NO = process.argv[2] || '337'
const BASE = process.env.PROBE_BASE || 'http://localhost:5173/boundless-whbis/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9344
const PROFILE = path.join(process.env.TMP || '.', 'edge-ctrl-prof')
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
  const cs = card ? getComputedStyle(card) : null;
  // 卡片内四块：搜索行 / 主操作行 / 视图行（原生模式下不存在）/ 方向行
  const blocks = card
    ? ['ctrl-search', 'ctrl-tools', 'ctrl-view', 'ctrl-dir']
        .map((c) => ({ name: c, box: document.querySelector('.' + c) }))
        .filter((x) => x.box)
        .map((x) => ({ name: x.name, box: r(x.box) }))
    : [];
  const tabs = [...dir.querySelectorAll('.dir-tab')].map((n) => ({ text: n.innerText.trim(), box: r(n), txt: textBox(n), active: n.classList.contains('active') }));
  const cur = dir.querySelector('.dir-cur');
  const swap = dir.querySelector('.dir-swap');
  const org = dir.querySelector('.ctrl-org');
  const tag = dir.querySelector('.org-tag');
  const name = dir.querySelector('.org-name');
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    rpx: +(document.documentElement.clientWidth / 750).toFixed(3),
    card: card ? { box: r(card), bg: cs.backgroundColor, radius: cs.borderRadius, border: cs.borderTopWidth, overflow: card.scrollWidth > card.clientWidth + 1 } : null,
    blocks,
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
    out.push(`四块内容（${m.blocks.map((b) => b.name).join(' / ')}）卡内=${inside ? '✓' : '✗'} 左缘对齐=${aligned ? '✓' : '✗ spread=' + (Math.max(...lefts) - Math.min(...lefts)).toFixed(1)}`)
    out.push(`卡片横向溢出=${m.card.overflow ? '✗ 有' : '✓ 无'}`)
    // 区块顺序：搜索 → 主操作 → 方向（含线路号/徽标）→ 视图工具（挂在其下方）
    const topOf = (n) => { const b = m.blocks.find((x) => x.name === n); return b ? b.box.t : null }
    const order = ['ctrl-search', 'ctrl-tools', 'ctrl-dir', 'ctrl-view'].map(topOf).filter((v) => v != null)
    const ordered = order.every((v, i) => i === 0 || v > order[i - 1])
    out.push(`区块顺序 搜索→主操作→方向→视图 ${ordered ? '✓' : '✗ ' + order.join(' / ')}`)
    out.push(`已移除说明文字（.view-hint）=${m.hasHint ? '✗ 仍在' : '✓'}`)
  } else out.push('✗ 没找到 .ctrl 卡片')
  // 主操作行：应该只剩一键查询，且撑满卡片内容宽（方向切换已移入方向行）
  if (m.tools && m.tools.length === 1) {
    const a = m.tools[0]
    const diff = +(a.box.w - m.dir.w).toFixed(1)
    out.push(`主操作「${a.text}」${a.box.w}px / 方向行宽 ${m.dir.w}px 独占整行=${Math.abs(diff) <= 2 ? '✓' : '✗ 差 ' + diff + 'px'}`)
  } else if (m.tools) out.push(`✗ 主操作行还有 ${m.tools.length} 枚按钮（应只剩一键查询）`)
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
