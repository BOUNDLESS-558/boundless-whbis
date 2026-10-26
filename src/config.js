/**
 * 应用配置
 *
 * ⚠️ openId 说明（2026-10-22 实测确认）：
 *   服务端只检查请求头 openId 是否存在，**不校验其值**，
 *   因此这里填任意非空字符串即可。真实小程序中该值是微信 openId。
 *   若将来服务端加强校验，替换为真实 openId 即可，无需改动其它代码。
 */
export const APP_CONFIG = {
  // 请求头 openId（必填，非空 ASCII 字符串）
  openId: 'wx_openid_dev_001',

  // 城市编码
  cityCode: '420100',

  // 以下为真实抓包中的客户端标识，服务端均可缺省，保留以贴近真实请求
  xiaomaAppId: 'wxaa1d01cdc96a2c0c',
  appKey: 'A0CADFE6F3B914A2',
  appType: 4,
  codeType: 1,
  channelId: 23000003,
  appSource: 2,

  // 地图服务商 Key（高德 Web端(JS API) Key）。⚠ 出于安全不再内置：
  // 留空时地图页自动降级为「线路示意图」，用户需在首页右上角「地图服务设置」自行填入高德 Key 才能查看实时地图
  mapKey: '',

  // 公交 API 反向代理地址（Cloudflare Worker，见 deploy/cloudflare-worker.js）。⚠ 仅 H5 生产环境生效：
  // GitHub Pages 等纯静态托管无法代理请求，直连 customized.wuhanbus.com 会被浏览器 CORS 预检拦截；
  // 部署 Worker 后填入其地址（如 https://whbis-proxy.xxx.workers.dev，末尾不带斜杠）。
  // 留空时回退直连真实域名（仅对无 CORS 限制的环境——如本地预览其他代理源——有用）。
  apiProxy: 'https://whbis-proxy.lwu584742.workers.dev',
}

// 线路 ID 编码规则：{cityCode}-{线路号}-{方向}，方向 0/1 表示上下行
export function buildLineCode(lineNo, direction = 0) {
  return `${APP_CONFIG.cityCode}-${lineNo}-${direction}`
}

// ---- 高德 Key 用户自定义（BYOK，H5）----
// 用户在高德开放平台自行申请「Web端(JS API)」Key 与安全密钥后填入，
// 存 localStorage，地图用量计入用户自己的高德账号。项目不再内置 Key，未填时地图降级为示意图。
const AMAP_BYOK_KEY = 'amap_byok_config'

export function getUserAmapConfig() {
  try {
    const c = uni.getStorageSync(AMAP_BYOK_KEY)
    return c && c.key ? c : null
  } catch (e) {
    return null
  }
}

export function saveUserAmapConfig(cfg) {
  uni.setStorageSync(AMAP_BYOK_KEY, cfg || {})
}

export function clearUserAmapConfig() {
  uni.removeStorageSync(AMAP_BYOK_KEY)
}

// 是否有可用的地图 Key（用户自定义 或 内置）；无 Key 时地图页降级为线路示意图
export function hasMapKey() {
  const u = getUserAmapConfig()
  return !!((u && u.key) || (APP_CONFIG.mapKey && APP_CONFIG.mapKey.trim()))
}

// ---- 地图渲染方式（与 Key 解耦，两套视觉效果二选一）----
// 'auto'（默认）：有 Key 用原生 <map>，无 Key 用自绘走向图（旧行为）
// 'schematic'：始终用自绘走向图（青蓝/玫红分色、双向分轨、站名白底贴片），免 Key
// 'native'：始终用原生 <map>（高德底图 + 原生 marker/polyline），无 Key 时自动回退自绘
const MAP_MODE_KEY = 'map_render_mode'

export function getMapMode() {
  try {
    const m = uni.getStorageSync(MAP_MODE_KEY)
    return m === 'native' || m === 'schematic' ? m : 'auto'
  } catch (e) {
    return 'auto'
  }
}

export function saveMapMode(mode) {
  try {
    if (mode === 'native' || mode === 'schematic') uni.setStorageSync(MAP_MODE_KEY, mode)
    else uni.removeStorageSync(MAP_MODE_KEY)
  } catch (e) { /* 忽略存储异常，下次按 auto 处理 */ }
}

// 当前是否应该渲染原生 <map>：两处入口（设置页 / 地图页）必须共用这一个判据，
// 否则会出现“设置页显示原生、地图页却画自绘”的不一致。
export function useNativeMap() {
  if (getMapMode() === 'schematic') return false
  return hasMapKey()
}

// H5：把用户 Key 注入 uni-app 运行时配置，供 <map> 组件加载高德 SDK 时使用。
// 原理：@dcloudio/uni-h5 的 loadMaps() 从全局 __uniConfig.aMapKey / aMapSecurityJsCode
// 读取 Key 拼接 script 标签，在页面创建前覆写这两个字段即可接管加载源。
// ⚠高德 SDK 一旦加载无法换 Key，保存配置后需整页重载才生效。
export function applyAmapConfig() {
  // #ifdef H5
  const c = getUserAmapConfig()
  if (c && c.key && typeof window !== 'undefined' && window.__uniConfig) {
    window.__uniConfig.aMapKey = c.key
    window.__uniConfig.aMapSecurityJsCode = c.securityJsCode || ''
  }
  // #endif
}
