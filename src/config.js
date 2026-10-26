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

  // 地图服务商 Key（高德 Web端(JS API) Key）。App 端随安装包内置（manifest.json sdkConfigs.maps.amap.key）；
  // H5 端留空时 useNativeMap() 为假，地图自动降级为自绘走向图（免 Key 的 OSRM 贴路 + 高德免 Key 瓦片）
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

// 当前是否渲染原生 <map>。
// 地图 Key 不再走用户自定义（BYOK 已移除），只认 manifest.json 的 sdkConfigs.maps.amap.key
// （App 端随安装包内置）。H5 端该值留空时 useNativeMap() 为假，LineMap 自动降级为自绘走向图。
export function useNativeMap() {
  return !!(APP_CONFIG.mapKey && APP_CONFIG.mapKey.trim())
}
