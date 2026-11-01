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
 *                          minW, maxW, minH, maxH, heightProp:'height'|'maxHeight', onResize }
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

  // 设了显式高度（非 max-height）时给容器加滚动，避免内容被裁
  function ensureClip() {
    if (rh && heightProp === 'height') el.style.overflow = 'auto'
  }

  function applyStored() {
    if (isNarrow()) return
    const s = readSize(key)
    if (!s) return
    if (rw && s.w) el.style.width = Math.round(clamp(s.w, minW, maxW)) + 'px'
    if (rh && s.h) el.style[heightProp] = Math.round(clamp(s.h, minH, maxH)) + 'px'
    ensureClip()
  }
  applyStored()
  // 记忆尺寸改变了占位，通知宿主重排（控制卡/侧栏要重新量 fitRect）
  if (onResize) requestAnimationFrame(() => onResize())

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

  return { destroy, reset }
}
