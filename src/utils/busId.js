/**
 * 车辆自编号还原
 *
 * 背景：接口返回的 busId / busNo 是内部车辆编号的 MD5 摘要
 *   busId = MD5( orgBusId )
 * orgBusId 为纯数字字符串，实测范围在 0 ~ 80000 以上。
 *
 * 性能考量：完整枚举 20 万个编号需上百毫秒（移动端更慢），
 * 直接同步执行会阻塞 UI。因此采用「分片异步构建 + 内存缓存 + 就绪回调」。
 */
import { md5 } from './md5.js'

/** 枚举上限（实测最大值 72541，留足余量） */
const DICT_MAX = 200000
/** 每片数量 —— 控制在单次任务 10ms 量级，避免掉帧 */
const CHUNK_SIZE = 8000

/** 已知对照表（来自接口抓包实测，直接命中无需等待字典） */
const KNOWN_BUS_IDS = {
  '2f9fb60d8cd21c36765ffb4c04a86f35': '32379',
  'd15426b9c324676610fbb01360473ed8': '3240',
  'fac99c77695b5655eefadf78498b8430': '32426',
  '040a99f23e8960763e680041c601acab': '3228',
  '6623f60e12e3d40244a0a59f4f765695': '32195',
  '5003307d211c815c97cc8bada9c6edec': '32415',
  '16fc18d787294ad5171100e33d05d4e2': '3306',
}

/** 编号字典：MD5(编号) -> 编号 */
let dict = null
let dictReady = false
let building = false
/** 就绪回调队列 */
const listeners = []

/**
 * 分片构建编号字典
 * 每次只处理 CHUNK_SIZE 个，让出主线程，保证界面不卡顿
 */
function startBuild() {
  if (building || dictReady) return
  building = true
  dict = Object.create(null)
  // 先填入已知对照表
  for (const [h, id] of Object.entries(KNOWN_BUS_IDS)) dict[h] = id

  let n = 0
  const step = () => {
    const end = Math.min(n + CHUNK_SIZE, DICT_MAX)
    for (let i = n; i <= end; i++) {
      const s = String(i)
      const h = md5(s)
      if (dict[h] === undefined) dict[h] = s
    }
    n = end
    // 注意：判断必须用 end >= DICT_MAX，用 n <= DICT_MAX 会在 n == DICT_MAX 时死循环
    if (end >= DICT_MAX) {
      dictReady = true
      building = false
      const cbs = listeners.splice(0, listeners.length)
      cbs.forEach((cb) => { try { cb() } catch (e) { /* 忽略回调异常 */ } })
    } else {
      setTimeout(step, 0)
    }
  }
  setTimeout(step, 0)
}

/**
 * 预热：在 App 启动时调用，让字典在用户浏览期间后台构建完成
 */
export function warmUp() {
  startBuild()
}

/**
 * 还原加密车辆编号
 * @param {string} hash busId / busNo（32 位小写十六进制）
 * @returns {string|null} 原始自编号；字典未就绪时可能返回 null
 */
export function decryptBusId(hash) {
  if (!hash || hash.length !== 32) return null
  const h = hash.toLowerCase()
  if (KNOWN_BUS_IDS[h]) return KNOWN_BUS_IDS[h]
  if (!dict) startBuild()
  if (!dictReady) return null
  return dict[h] || null
}

/**
 * 批量还原
 * @param {string[]} hashes
 * @returns {Array<string|null>}
 */
export function decryptBusIds(hashes) {
  return (hashes || []).map((h) => decryptBusId(h))
}

/**
 * 字典就绪回调（用于 UI 二次刷新）
 * @param {Function} cb 回调
 */
export function onBusIdReady(cb) {
  if (dictReady) {
    cb()
    return
  }
  listeners.push(cb)
  startBuild()
}

/**
 * 字典是否已就绪
 */
export function isBusIdReady() {
  return dictReady
}
