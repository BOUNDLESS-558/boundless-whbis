/**
 * 面板自由缩放（仅 H5/桌面）
 *
 * 给一个真实 DOM 元素挂一个拖拽手柄，按住即可改宽/高，松手写入 uni storage，
 * 下次打开自动恢复；双击手柄恢复默认尺寸（清除记忆）。
 *
 * 为什么只走原生 DOM + Pointer Events：uni-app H5 对 <view> 的 mouse 事件绑定不可靠
 * （见 AGENTS.md「uni-h5 陷阱」），而 App 端没有 document，缩放能力只在网页版提供，
 * App 保持各面板自带的固定尺寸。窄屏（<=720px）不接管，沿用响应式塌缩。
 *
 * 手柄用 JS 内联样式绘制（不用 scoped CSS 类）：动态 createElement 出来的节点拿不到
 * Vue 编译期加的 data-v-* 作用域属性，scoped 选择器匹配不到它。
 */

const STORE_PREFIX = 'whbis:panel-size:v1:'

function clamp(v, lo, hi) {
  if (hi < lo) hi = lo
  return Math.min(Math.max(v, lo), hi)
}

// 窄屏判据：命中则本工具完全不介入（不加手柄、不应用/写记忆尺寸）
function isNarrow() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 720px)').matches
}

// uni H5 存储兜底：get 可能返回对象，也可能返回 JSON 字符串（同 auth.js 的 readStore）
function readSize(key) {
  let v
  try {
    v = uni.getStorageSync(STORE_PREFIX + key)
  } catch (e) {
    return null
  }
  if (!v) return null
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch (e) { return null }
  }
  return v && typeof v === 'object' ? v : null
}

function writeSize(key, size) {
  try {
    uni.setStorageSync(STORE_PREFIX + key, size)
  } catch (e) { /* 存储不可用，静默 */ }
}

function clearSize(key) {
  try {
    uni.removeStorageSync(STORE_PREFIX + key)
  } catch (e) { /* 忽略 */ }
}

// 按 edge 造一个内联样式的手柄
function makeGrip(edge) {
  const g = document.createElement('div')
  g.className = 'rs-grip rs-' + edge
  const s = g.style
  s.position = 'absolute'
  s.zIndex = '40'
  s.touchAction = 'none'
  s.userSelect = 'none'
  s.webkitUserSelect = 'none'
  if (edge === 'right' || edge === 'left') {
    s.top = '0'
    s.height = '100%'
    s.width = '9px'
    s.cursor = 'ew-resize'
    if (edge === 'right') s.right = '0'; else s.left = '0'
    s.background = 'transparent'
  } else if (edge === 'bottom') {
    s.left = '0'
    s.width = '100%'
    s.height = '9px'
    s.cursor = 'ns-resize'
    s.bottom = '0'
    s.background = 'transparent'
  } else { // corner：右下角一块斜角，同时改宽和高
    s.right = '0'
    s.bottom = '0'
    s.width = '18px'
    s.height = '18px'
    s.cursor = 'nwse-resize'
    s.background = 'linear-gradient(135deg, transparent 50%, rgba(103, 232, 249, 0.5) 50%)'
    s.borderBottomRightRadius = '8px'
  }
  g.title = '拖动改变大小 · 双击恢复默认'
  return g
}

/**
 * @param {Element} el    目标面板的真实 DOM 节点
 * @param {Object}  opts  { key, axis:'x'|'y'|'both', edge:'right'|'left'|'bottom'|'corner',
 *                          minW, maxW, minH, maxH, heightProp:'height'|'maxHeight', onResize,
 *                          clip:false 时不给容器加 overflow（避免把宿主内绝对定位的浮层裁掉） }
 * @returns {{ destroy:Function, reset:Function }}
 */
export function createResizable(el, opts = {}) {
  const noop = { destroy() {}, reset() {} }
  if (!el || typeof document === 'undefined') return noop
  const key = opts.key
  if (!key) return noop

  const axis = opts.axis || 'both'
  const edge = opts.edge || 'corner'
  const minW = opts.minW || 240
  const maxW = opts.maxW || 2000
  const minH = opts.minH || 120
  const maxH = opts.maxH || 2000
  const heightProp = opts.heightProp || 'height'
  const onResize = typeof opts.onResize === 'function' ? opts.onResize : null
  const rw = axis === 'x' || axis === 'both'
  const rh = axis === 'y' || axis === 'both'
  const clip = opts.clip !== false

  // 设了显式高度（非 max-height）时给容器加滚动，避免内容被裁；
  // 但宿主内若有绝对定位浮层（如控制卡里的联想面板），clip:false 时不加，否则浮层被裁
  function ensureClip() {
    if (clip && rh && heightProp === 'height') el.style.overflow = 'auto'
  }

  // clip:false + height 时不会加 overflow，若记忆/拖拽出的高度比内容矮，
  // 内容（如全市态底部「重扫 / 自动跟随 / 自编号 / 车速榜」）就会溢出到卡片之外。
  // 这里把高度调整到内容真实高度（上限 maxH），保证内容永远被卡片包裹。
  // 关键：不能直接用 el.scrollHeight —— 设了 inline height 后 scrollHeight 会被撑到≈height，
  // 永远算不出"内容真实高度"，收缩分支因此失效（卡片底部留空白的根因）。
  // 做法：临时摘掉 inline height 让浏览器按内容回流，读一次真实高度，再立即写回目标高度。
  // 同步执行无视觉闪烁；overflow 仍保持 visible，避免裁掉绝对定位的联想下拉。
  // allowShrink：默认只放大（拖拽时用，尊重用户主动拉大的高度）；仅 applyStored 时传 true，
  // 用于清掉"记忆里留着上次拖大高度"导致的过期虚高（内容没那么多却留大片空白）。
  function refit(allowShrink = false) {
    if (clip || !rh || heightProp !== 'height') return
    if (!el.style.height) return
    const cur = el.getBoundingClientRect().height
    const prev = el.style.height
    el.style.height = ''
    // scrollHeight 含内边距但不含边框，补上边框再 +1 防亚像素，宁可略高也不溢出
    const border = Math.max(0, el.offsetHeight - el.clientHeight)
    const need = el.scrollHeight + border + 1
    el.style.height = prev
    let next = null
    if (need > cur + 1) {
      next = Math.round(clamp(need, minH, maxH))
    } else if (allowShrink && need < cur - 1 && need >= minH) {
      // 内容变少时同步收缩，避免卡片底部留大片空白（只在读取存储时做，不影响拖拽）
      next = Math.round(need)
    }
    if (next != null) {
      el.style.height = next + 'px'
      // 只在 applyStored 的收缩矫正里同步纠正存储（拖拽时 end() 会写用户拖的真实高度，
      // 这里再写会覆盖用户意图）。readSize 可能返回 {w} 单独项，需保留。
      if (allowShrink) {
        const s = readSize(key) || {}
        writeSize(key, { ...s, h: next })
      }
    }
  }

  function applyStored() {
    if (isNarrow()) return
    const s = readSize(key)
    if (!s) return
    if (rw && s.w) el.style.width = Math.round(clamp(s.w, minW, maxW)) + 'px'
    if (rh && s.h) el.style[heightProp] = Math.round(clamp(s.h, minH, maxH)) + 'px'
    ensureClip()
    refit(true)
  }
  applyStored()
  // 记忆尺寸改变了占位，通知宿主重排（控制卡/侧栏要重新量 fitRect）。
  // 必须同步调用：FloatWin 的 winStyle 用 rsW || 默认宽，若等 rAF 则首渲染
  // 已用默认宽把 applyStored 写进去的记忆尺寸覆盖掉，下次开窗就又回到默认宽度
  if (onResize) onResize()

  const grip = makeGrip(edge)
  el.appendChild(grip)

  let drag = null
  let raf = 0

  function start(e) {
    if (isNarrow()) return
    e.preventDefault()
    e.stopPropagation()
    const r = el.getBoundingClientRect()
    drag = { x0: e.clientX, y0: e.clientY, w: r.width, h: r.height }
    if (edge !== 'corner') grip.style.background = 'rgba(103, 232, 249, 0.28)'
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
  }

  function move(e) {
    if (!drag) return
    const dx = e.clientX - drag.x0
    const dy = e.clientY - drag.y0
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (!drag) return
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
      if (rw) {
        // 右锚定的侧栏（edge:'left'）向左变宽，位移取反
        const raw = edge === 'left' ? drag.w - dx : drag.w + dx
        el.style.width = Math.round(clamp(raw, minW, Math.min(maxW, vw - 16))) + 'px'
      }
      if (rh) {
        const raw = drag.h + dy
        el.style[heightProp] = Math.round(clamp(raw, minH, Math.min(maxH, vh - 16))) + 'px'
        ensureClip()
        refit()
      }
      if (onResize) onResize()
    })
  }

  function end() {
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (edge !== 'corner') grip.style.background = 'transparent'
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', end)
    drag = null
    const r = el.getBoundingClientRect()
    const size = {}
    if (rw) size.w = Math.round(r.width)
    if (rh) size.h = Math.round(r.height)
    writeSize(key, size)
  }

  function reset() {
    clearSize(key)
    el.style.width = ''
    el.style[heightProp] = ''
    if (heightProp === 'height') el.style.overflow = ''
    if (onResize) onResize()
  }

  function dbl(e) {
    e.preventDefault()
    e.stopPropagation()
    reset()
  }

  grip.addEventListener('pointerdown', start)
  grip.addEventListener('dblclick', dbl)

  function destroy() {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', end)
    if (raf) cancelAnimationFrame(raf)
    if (grip.parentNode) grip.parentNode.removeChild(grip)
  }

  return { destroy, reset, refit }
}
