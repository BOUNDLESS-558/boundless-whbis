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

// 是否有可用的地图 Key（用户自定义 或 内置）
export function hasMapKey() {
  const u = getUserAmapConfig()
  return !!((u && u.key) || (APP_CONFIG.mapKey && APP_CONFIG.mapKey.trim()))
}

// 高德开放平台「我的应用 / 创建 Key」控制台，用于引导用户申请 Web端(JS API) Key
export const AMAP_CONSOLE_URL = 'https://console.amap.com/dev/key/app'

// 打开外部网页：H5 新标签页；App 走系统浏览器；其它端复制地址兜底
export function openExternal(url) {
  const target = url || AMAP_CONSOLE_URL
  // #ifdef H5
  try { window.open(target, '_blank') } catch (e) { /* 忽略弹窗被拦截 */ }
  // #endif
  // #ifndef H5
  try {
    plus.runtime.openURL(target)
  } catch (err) {
    uni.setClipboardData({ data: target, success: () => uni.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' }) })
  }
  // #endif
}

// 地图功能是否可用：⚠ 必须填写高德 Key 才能查看在线车辆走向。
// App 端 Key 随安装包内置（manifest 的 sdkConfigs），故恒为可用；
// H5 / 小程序等未内置 Key 的端，只有 hasMapKey() 为真时才启用地图（否则地图页显示引导锁屏）。
export function mapFeatureAvailable() {
  // #ifdef APP-PLUS
  return true
  // #endif
  // #ifndef APP-PLUS
  return hasMapKey()
  // #endif
}

// 当前是否渲染原生 <map>：已去掉「自动 / 走向图 / 原生」三档选项，底层一律用原生地图。
// 有 Key → 原生地图；无 Key → 地图功能不启用（mapFeatureAvailable 为假，地图页显示引导锁屏），
// 因此 useNativeMap() 实际等价于 hasMapKey()，仅在 mapFeatureAvailable 为真的页面上才会被用到。
export function useNativeMap() {
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
