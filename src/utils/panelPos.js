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
