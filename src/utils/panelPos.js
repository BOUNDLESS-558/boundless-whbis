/**
 * 可拖动面板的「上次位置」记忆（与 panelResize.js 的尺寸记忆是两套独立存储）
 *
 * 存的是视口绝对坐标 {x, y}。读取后必须再过一次 clampPanelPos：换了窗口大小、
 * 窄屏 / 横竖屏切换后，旧坐标可能已经落到屏幕外，直接套用会让面板找不回来。
 *
 * 只在「真的拖动过」才写入（调用方判断 moved），默认居中位置不落盘，
 * 否则首次开窗就把 CSS 贴底态固化成绝对坐标，内容异步变高时会往下溢出。
 */

const STORE_PREFIX = 'whbis:panel-pos:v1:'

function clamp(v, lo, hi) {
  if (hi < lo) hi = lo
  return Math.min(Math.max(v, lo), hi)
}

/** uni H5 存储可能回对象，也可能回 JSON 字符串（同 auth.js / panelResize.js 的口径） */
export function readPanelPos(key) {
  if (!key) return null
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
  if (!v || typeof v !== 'object') return null
  const x = Number(v.x)
  const y = Number(v.y)
  if (!isFinite(x) || !isFinite(y)) return null
  return { x, y }
}

export function writePanelPos(key, pos) {
  if (!key || !pos) return
  try {
    uni.setStorageSync(STORE_PREFIX + key, { x: Math.round(pos.x), y: Math.round(pos.y) })
  } catch (e) { /* 存储不可用，静默 */ }
}

export function clearPanelPos(key) {
  if (!key) return
  try { uni.removeStorageSync(STORE_PREFIX + key) } catch (e) { /* 忽略 */ }
}

/** 把坐标夹进当前视口（w/h 用面板实测尺寸），换设备后也能安全恢复 */
export function clampPanelPos(pos, w, h, pad = 6) {
  if (!pos) return null
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 375
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 667
  const ww = Number(w) > 0 ? Number(w) : 320
  const hh = Number(h) > 0 ? Number(h) : 360
  return {
    x: clamp(Number(pos.x) || 0, pad, Math.max(pad, vw - ww - pad)),
    y: clamp(Number(pos.y) || 0, pad, Math.max(pad, vh - hh - pad)),
  }
}

/**
 * 给浮窗绑拖拽：只按 handle（标题栏 grip）拖，面板本体不被拖动，避免误伤内部按钮 / 输入。
 * 每次移动回调 onDrag(位置, 'move')，松手回调用最终位置 onDrag(位置, 'end') 供写存储。
 * 返回解绑函数；面板 v-if 重新挂载时调用方需重绑。
 */
export function bindFloatDrag(handle, panel, onDrag) {
  if (!handle || !panel || typeof document === 'undefined') return () => {}
  let d = null
  const pt = (e) => (e.touches && e.touches[0])
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX, y: e.clientY }
  const down = (e) => {
    if (e.target && e.target.closest && e.target.closest('.fd-nodrag')) return
    const p = pt(e)
    const r = panel.getBoundingClientRect()
    d = { ox: p.x - r.left, oy: p.y - r.top, x0: p.x, y0: p.y, w: r.width, h: r.height, moved: false, last: null }
    if (e.type === 'mousedown') {
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    }
  }
  const move = (e) => {
    if (!d) return
    if (e.cancelable) e.preventDefault()
    const p = pt(e)
    if (!d.moved && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) < 3) return
    d.moved = true
    d.last = clampPanelPos({ x: p.x - d.ox, y: p.y - d.oy }, d.w, d.h)
    onDrag(d.last, 'move')
  }
  const up = () => {
    if (d && d.moved && d.last) onDrag(d.last, 'end')
    d = null
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  handle.addEventListener('mousedown', down)
  handle.addEventListener('touchstart', down, { passive: true })
  handle.addEventListener('touchmove', move, { passive: false })
  handle.addEventListener('touchend', up)
  handle.addEventListener('touchcancel', up)
  return () => {
    handle.removeEventListener('mousedown', down)
    handle.removeEventListener('touchstart', down)
    handle.removeEventListener('touchmove', move)
    handle.removeEventListener('touchend', up)
    handle.removeEventListener('touchcancel', up)
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
}
