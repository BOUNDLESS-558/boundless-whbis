/**
 * 武汉公交信息实时查询运营 API 请求层
 * 封装 3 个核心接口：线路/站点、计划发车、实时车辆
 * 接口文档见同级目录 boundless-whbis/《武汉公交信息实时查询API接口文档.md》附录 0
 *
 * ⚠️ 调用协议要点（2026-10-22 实测确认，务必照做，否则一律返回 code:90001 缺少openId）：
 *   1. 必须用 POST + application/json，GET 不支持
 *   2. openId 必须放在 **请求头**（header），放 query / body 均无效
 *   3. openId 的值服务端不校验，任意非空字符串即可（真实小程序里是微信 openId）
 *   4. body 必须含 cityCode；/line 用 lineCode，/detailPlanTime 与 /detailData 用 lineId
 */
import { APP_CONFIG } from '../config.js'
import { decryptBusId, decryptBusIds, warmUp, onBusIdReady, isBusIdReady } from './busId.js'

// 接口基础地址
// H5 开发环境下通过 vite 代理（/api -> gps-resapi/wechat/bus）规避跨域
const PROXY_PREFIX = '/api'
const DIRECT_BASE = 'https://customized.wuhanbus.com/gps-resapi/wechat/bus'

// 判断是否为 H5 环境
// #ifdef H5
const isH5 = true
// #endif
// #ifndef H5
const isH5 = false
// #endif

// H5 开发环境走 vite 代理（/api）规避跨域；H5 生产（Pages 等静态托管）优先用反代地址 apiProxy
// （直连会被浏览器 CORS 预检拦截），未配置时回退直连；非 H5（App/小程序）无 CORS 限制，直连
// 生产 H5：主线路 = Vercel 同域转发（vercel.json rewrites），备用 = Cloudflare Worker
const trimBase = (u) => String(u).replace(/\/+$/, '')
const PROD_BASES = [APP_CONFIG.apiPrimary, APP_CONFIG.apiProxy].filter(Boolean).map(trimBase)
if (!PROD_BASES.length) PROD_BASES.push(DIRECT_BASE)
const BASES = isH5 ? (process.env.NODE_ENV !== 'production' ? [PROXY_PREFIX] : PROD_BASES) : [DIRECT_BASE]
// 某条线路失败后暂时降级（毫秒），期间优先走下一条，到期再试回主线路
const DEMOTE_MS = 5 * 60 * 1000
const demotedUntil = {}
function orderedBases() {
  const now = Date.now()
  const ok = BASES.filter((b) => !(demotedUntil[b] > now))
  const bad = BASES.filter((b) => demotedUntil[b] > now)
  return ok.concat(bad)
}

/** 通用请求体字段（来自真实抓包；除 cityCode 外其余服务端均可缺省） */
function baseBody() {
  return {
    cityCode: APP_CONFIG.cityCode,
    xiaomaAppId: APP_CONFIG.xiaomaAppId,
    appKey: APP_CONFIG.appKey,
    appType: APP_CONFIG.appType,
    codeType: APP_CONFIG.codeType,
    channelId: APP_CONFIG.channelId,
    appSource: APP_CONFIG.appSource,
  }
}

/**
 * 通用 POST 请求封装
 * @param {string} path 接口路径，如 '/line'
 * @param {Object} body 业务参数（会与通用字段合并）
 * @returns {Promise<Object>} 返回响应的 data 字段
 */
async function post(path, body = {}) {
  const bases = orderedBases()
  let lastErr = null
  for (let i = 0; i < bases.length; i++) {
    try {
      return await postOnce(bases[i], path, body)
    } catch (e) {
      lastErr = e
      // 只有线路层故障（网络错误 / 429 / 5xx / CORS）才换线；业务错误直接抛出
      if (!e || !e.transport) throw e
      if (bases.length > 1) demotedUntil[bases[i]] = Date.now() + DEMOTE_MS
    }
  }
  throw lastErr
}

function postOnce(base, path, body) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: base + path,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        // ★ openId 必须走 header，服务端只认这里
        openId: APP_CONFIG.openId,
      },
      data: Object.assign(baseBody(), body),
      timeout: 15000,
      success: (res) => {
        if (res.statusCode === 429 || res.statusCode >= 500) {
          const err = new Error('代理线路不可用（HTTP ' + res.statusCode + '）')
          err.transport = true
          return reject(err)
        }
        const payload = res.data
        if (payload && payload.success === true && payload.msg && payload.msg.code === '20000') {
          resolve(payload.data)
        } else {
          const msg = (payload && payload.msg && payload.msg.message) || '请求失败'
          reject(new Error(msg))
        }
      },
      fail: (err) => {
        const e = new Error((err && err.errMsg) || '网络错误')
        e.transport = true
        reject(e)
      },
    })
  })
}

/**
 * 获取线路及站点站名信息
 * @param {string} lineCode 线路编码，格式 420100-{线路号}-{方向0|1}
 * @returns {Promise<Object>} { lineDetailBaseDto, stopDetailList }
 */
export function fetchLine(lineCode) {
  return post('/line', { lineCode })
}

/**
 * 获取计划营运车辆信息（发车计划/时刻表）
 * @param {string} lineId 线路 ID，格式 420100-{线路号}-{方向0|1}
 * @returns {Promise<Array>} 计划发车车辆数组
 */
export function fetchPlanTime(lineId) {
  return post('/detailPlanTime', { lineId })
}

/**
 * 获取在线运营车辆信息（实时 GPS）
 * @param {string} lineId 线路 ID，格式 420100-{线路号}-{方向0|1}
 * @returns {Promise<Object>} { lineBusDtoList, plans }
 */
export function fetchRealTime(lineId) {
  return post('/detailData', { lineId })
}

// ---- 车辆编号还原（busId/busNo = MD5(orgBusId)）----
// 具体实现见 ./busId.js，采用分片异步构建字典，避免阻塞 UI

export { decryptBusId, decryptBusIds, warmUp, onBusIdReady, isBusIdReady }

export default {
  fetchLine,
  fetchPlanTime,
  fetchRealTime,
  decryptBusId,
}