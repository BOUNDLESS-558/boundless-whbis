/**
 * 车辆完整自编号显示映射
 *
 * 背景：接口还原出的自编号是纯数字（如 325311），但真实车辆编号含车型字母
 *   （如 325F311）。字母由车型决定、不按数字规律变化，只能靠对照表补全。
 * 对照表来源：buspedia.top 车队页采集 → src/static/data/bus-number-map.json
 *   结构：byNum[去字母数字] = [完整编号, ...]
 *
 * 设计：映射表约 900KB，走 HTTP 缓存懒加载（不 import 进 bundle 拖慢首屏），
 *   与 busId.js 一样提供「就绪回调」，加载完成后 UI 可二次刷新。
 * 注意：本模块只用于「显示」，原始纯数字 orgId 必须保留用于 md5 反查车辆。
 */
import { assetUrl } from './asset.js'

let MAP = null
let pending = null
const listeners = []

/** 加载映射表（模块内缓存 Promise，只加载一次） */
function ensureLoaded() {
  if (MAP) return Promise.resolve(MAP)
  if (pending) return pending
  pending = new Promise((resolve) => {
    uni.request({
      url: assetUrl('/static/data/bus-number-map.json'),
      method: 'GET',
      timeout: 30000,
      success: (res) => {
        try {
          const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          MAP = (body && body.byNum) || {}
          // byFull 供完整编号反查纯数字用（键转大写便于大小写无关匹配）
          if (body && body.byFull && MAP) {
            const bf = Object.create(null)
            Object.keys(body.byFull).forEach((k) => { bf[k.toUpperCase()] = body.byFull[k] })
            MAP.__byFull = bf
          }
        } catch (e) { MAP = {} }
      },
      fail: () => { MAP = {} },
      complete: () => {
        const cbs = listeners.splice(0, listeners.length)
        cbs.forEach((cb) => { try { cb() } catch (e) {} })
        resolve(MAP)
      },
    })
  })
  return pending
}

/** 启动时预加载（App.vue onLaunch 调用，不阻塞） */
export function warmUpBusNumber() {
  ensureLoaded()
}

/**
 * 把纯数字自编号格式化为完整编号（用于显示）
 * @param {string} orgId 纯数字自编号，如 325311
 * @returns {string} 完整编号（如 325F311）；无映射或未就绪时返回原值
 */
export function formatBusNo(orgId) {
  if (!orgId) return orgId
  if (!MAP) return String(orgId)
  const list = MAP[String(orgId)]
  return (list && list.length) ? list[0] : String(orgId)
}

/**
 * 按纯数字自编号取车辆具体车型（如 XMQ6127GHEV4）。
 * 映射表 byFull[完整编号].model 由 buspedia 车队页采集，与 byNum 同源。
 * @param {string} orgId 纯数字自编号，如 325311
 * @returns {string} 车型名；无映射或未就绪返回空串
 */
export function getBusModel(orgId) {
  if (!orgId || !MAP) return ''
  const full = formatBusNo(orgId)
  if (!full || full === String(orgId)) return ''
  const m = MAP.__byFull && (MAP.__byFull[String(full).toUpperCase()] || MAP.__byFull[full])
  return m && m.model ? String(m.model) : ''
}

/**
 * 把完整编号（含车型字母，如 325F311 / T19H6230）反查回纯数字自编号。
 * 用于「自编号查车」：地图标签显示的是完整编号，而快照里的 busId = MD5(纯数字)。
 * 只有拿到纯数字才能正向 MD5 命中车辆；映射表未就绪/无映射时返回原输入。
 * @param {string} full 用户输入的完整编号
 * @returns {string} 纯数字自编号（找不到则原样返回）
 */
export function parseBusNo(full) {
  if (!full || !MAP) return full
  const q = String(full).trim()
  // 已是纯数字直接返回
  if (/^\d+$/.test(q)) return q
  // 精确匹配：byNum[纯数字] = [完整编号, ...]
  const upper = q.toUpperCase()
  for (const num in MAP) {
    const list = MAP[num]
    if (Array.isArray(list) && list.some((s) => typeof s === 'string' && s.toUpperCase() === upper)) return num
  }
  // byFull 里也带 num/company/batch，可作为兜底（部分完整编号只在 byFull 里）
  const fullMap = MAP.__byFull
  if (fullMap && fullMap[upper]) {
    const meta = fullMap[upper]
    const num = String(meta.company || '') + String(meta.batch || '') + String(meta.num || '')
    if (/^\d+$/.test(num)) return num
  }
  return q
}

/** 映射表就绪回调（用于 UI 二次刷新） */
export function onBusNumberReady(cb) {
  if (MAP) { cb(); return }
  listeners.push(cb)
  ensureLoaded()
}

/** 是否已就绪 */
export function isBusNumberReady() {
  return !!MAP
}
