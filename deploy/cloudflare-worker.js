/**
 * Cloudflare Worker —— 武汉公交 API 反向代理（解决 GitHub Pages 纯静态托管的 CORS 预检拦截）
 *
 * 原理：浏览器对带自定义头(openId)的跨域 POST 必发 OPTIONS 预检，
 * 而 customized.wuhanbus.com 的 OPTIONS 响应不含 CORS 头 → 被浏览器拦截。
 * Worker 与页面跨域但由我们自己补全 CORS 头：预检直接应答，POST 转发上游并回加 ACAO。
 *
 * 部署（约 2 分钟，免费额度 10 万请求/天）：
 *   1. 注册 https://dash.cloudflare.com （免费账号即可）
 *   2. 控制台 → Workers 与 Pages → 创建 → 创建 Worker，起个名字（如 whbis-proxy）
 *   3. 把本文件全部内容粘贴进代码编辑器 → 保存并部署
 *   4. 拿到形如 https://whbis-proxy.<你的子域>.workers.dev 的地址
 *   5. 填入 src/config.js 的 APP_CONFIG.apiProxy → npm run deploy:pages
 *
 * 说明：上游路径写死为 /gps-resapi/wechat/bus/*，只转发 POST，不代理任何其他域名，
 * 无日志收集，请求体原样透传。
 */

const UPSTREAM_BASE = 'https://customized.wuhanbus.com/gps-resapi/wechat/bus'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, openId',
  'Access-Control-Max-Age': '86400',
}

// 仅允许这几个业务路径，避免变成任意转发器
const ALLOWED_PATHS = new Set(['/line', '/detailPlanTime', '/detailData'])

export default {
  async fetch(request) {
    const url = new URL(request.url)
    // 归一化路径：兼容 Worker 路由带前缀（如 /bus/line）的情况，取最后一段已知路径
    let path = url.pathname
    const known = [...ALLOWED_PATHS].find((p) => path.endsWith(p))
    if (!known) {
      return new Response('{"error":"not found"}', {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }
    path = known

    // CORS 预检：直接应答
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }
    if (request.method !== 'POST') {
      return new Response('{"error":"only POST allowed"}', {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...CORS },
      })
    }

    // 转发 POST：只带上游必需的两个头
    const body = await request.arrayBuffer()
    const upstream = await fetch(UPSTREAM_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        openId: request.headers.get('openId') || '',
      },
      body,
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        ...CORS,
      },
    })
  },
}
