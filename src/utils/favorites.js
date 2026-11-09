/**
 * 线路收藏夹（本地存储，最多 10 条）
 *
 * 收藏的是「线路」而非车辆：一条记录含展示号 no / 查询用 code / 起讫站 / 公司归属，
 * 点收藏夹里的一条即可直接发起实时公交查询（复用宿主的 pick 事件）。
 * 存的是线路摘要快照，不依赖线路库是否收录该线（非集团线路也能收藏）。
 *
 * 跨面板同步：各处的收藏按钮都订阅 onChange，任一处增删后全部按钮即时刷新高亮态。
 */
import { buildLineCode } from '../config.js'

const KEY = 'whbis:fav-lines:v1'
export const FAV_MAX = 10

const listeners = new Set()

function read() {
  try {
    const v = uni.getStorageSync(KEY)
    const arr = typeof v === 'string' ? JSON.parse(v) : v
    if (!Array.isArray(arr)) return []
    return arr.filter((x) => x && x.no).slice(0, FAV_MAX)
  } catch (e) { return [] }
}
function write(arr) {
  try { uni.setStorageSync(KEY, arr.slice(0, FAV_MAX)) } catch (e) { /* 存储不可用时仅本次会话生效 */ }
  const snapshot = arr.slice(0, FAV_MAX)
  listeners.forEach((fn) => { try { fn(snapshot) } catch (e) { /* 单个订阅者异常不影响其它 */ } })
  return snapshot
}

export function getFavorites() { return read() }
export function favCount() { return read().length }

/** 线路号大小写不敏感比较 */
export function isFavorite(no) {
  const k = String(no == null ? '' : no).trim().toUpperCase()
  return !!k && read().some((x) => String(x.no).toUpperCase() === k)
}

/** 订阅变更，返回取消订阅函数 */
export function onFavoritesChange(fn) {
  if (typeof fn === 'function') listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * 切换收藏状态。
 * @returns {{ok:boolean, added:boolean, reason?:string, list:Array}}
 *   added=true 表示已加入（按钮应高亮）；满 10 条时拒绝加入并给 reason
 */
export function toggleFavorite(line) {
  const no = String((line && (line.no || line.lineName)) || '').trim()
  if (!no) return { ok: false, added: false, reason: '线路号为空', list: read() }
  const arr = read()
  const i = arr.findIndex((x) => String(x.no).toUpperCase() === no.toUpperCase())
  if (i >= 0) {
    arr.splice(i, 1)
    return { ok: true, added: false, list: write(arr) }
  }
  if (arr.length >= FAV_MAX) {
    return { ok: false, added: false, reason: `收藏夹最多 ${FAV_MAX} 条，请先移除一条`, list: arr }
  }
  const item = {
    no,
    code: String((line && (line.code || line.lineCode)) || no),
    name: String((line && (line.name || line.lineName)) || no),
    start: String((line && (line.start || line.startStop)) || ''),
    end: String((line && (line.end || line.endStop)) || ''),
    org: String((line && (line.org || line.company)) || ''),
    companyKey: (line && line.companyKey) || '',
    ts: Date.now(),
  }
  arr.unshift(item)
  return { ok: true, added: true, list: write(arr) }
}

export function removeFavorite(no) {
  const k = String(no == null ? '' : no).toUpperCase()
  return write(read().filter((x) => String(x.no).toUpperCase() !== k))
}

export function clearFavorites() { return write([]) }

/** 收藏项 → 宿主 pick 事件需要的对象（与 LineSearch.buildPick 同形） */
export function toPick(item) {
  // 收藏存的是线路号（如 337 / C1），也可能已是完整 lineCode（420100-337-0）。
  // 统一补成标准编码，避免宿主 applyPick 反解不出线路号。
  const raw = String(item.code || item.no || '')
  const lineCode = raw.includes('-') ? raw : buildLineCode(raw, 0)
  return {
    lineCode,
    lineName: item.name || item.no,
    direction: 0,
    startStop: item.start || '',
    endStop: item.end || '',
    companyKey: item.companyKey || '',
    fromFav: true, // 标识来自收藏夹：即使当前在全市视图也应换线查询，而非就地筛选
  }
}

export default { getFavorites, isFavorite, toggleFavorite, removeFavorite, clearFavorites, onFavoritesChange, toPick, FAV_MAX }
