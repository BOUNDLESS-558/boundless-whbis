/**
 * 探测 2：amap.com 官方「公交线路详情」页能否作为 iframe 底图嵌入
 *
 * 关注点：
 *   1. 响应头是否禁止被 iframe 嵌入（X-Frame-Options / CSP frame-ancestors）
 *   2. SSR HTML 是否自带线路数据（站点列表 / 轨迹坐标），能否被 Worker 解析
 *   3. 不带 busId 只用线路号 keywords 能否出线路图（决定是否需要反查 busId）
 *   4. 页面内是否暴露 busId 搜索接口
 *
 * 用法：node scripts/probe-amap-embed.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const BASE = 'https://www.amap.com/ssr/search/busline_detail'
const TMP = path.join(os.tmpdir(), 'amap-embed-probe')
fs.mkdirSync(TMP, { recursive: true })

async function fetchPage(name, url) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://www.amap.com/',
      },
      signal: AbortSignal.timeout(15000),
    })
    const html = await res.text()
    const file = path.join(TMP, `${name}.html`)
    fs.writeFileSync(file, html, 'utf8')
    console.log(`\n[${name}] ${res.status} ${((Date.now() - t0) / 1000).toFixed(1)}s len=${html.length}`)
    console.log(`  x-frame-options: ${res.headers.get('x-frame-options') || '(无)'}`)
    const csp = res.headers.get('content-security-policy')
    console.log(`  CSP: ${csp ? csp.slice(0, 160) : '(无)'}`)
    console.log(`  content-type: ${res.headers.get('content-type')}`)
    // 是否含线路数据特征
    const marks = ['汉城路公交停车场', '公交停车场', 'busline', 'busId', '__INITIAL', 'window.g_config', 'lng', 'stopList', 'stop_name']
    console.log('  特征: ' + marks.map((m) => `${m}=${html.includes(m) ? 'Y' : 'N'}`).join(' '))
    console.log(`  saved: ${file}`)
    return html
  } catch (e) {
    console.log(`\n[${name}] 失败: ${e.message}`)
    return ''
  }
}

const params = 'query_type=TQUERY&query=%E7%BA%BF%E8%B7%AF&city=420100&geoobj=114.183559%7C30.498013%7C114.523448%7C30.679478&zoom=12'

// 1. 用户给出的完整 URL（337 路，带 busId + keywords）
const fullUrl = `${BASE}?query_type=TQUERY&query=337%E8%B7%AF&city=420100&geoobj=114.183559%7C30.498013%7C114.523448%7C30.679478&zoom=12&busId=900000128833&keywords=337%E8%B7%AF&key_name=337%E8%B7%AF`
const html1 = await fetchPage('with-busId', fullUrl)

// 2. 只有 keywords、无 busId
await fetchPage('keywords-only', `${BASE}?${params}&keywords=337%E8%B7%AF&key_name=337%E8%B7%AF`)

// 3. 无线路号参数（对照）
await fetchPage('no-keyword', `${BASE}?${params}`)

// 4. 从页面中抽取关键线索：站点数量、内部 API 路径、JSON 片段位置
if (html1) {
  const stopHits = (html1.match(/公交停车场/g) || []).length
  console.log(`\n[分析] "公交停车场" 出现次数: ${stopHits}`)
  // 抽所有 /service/ 或 /ssr/ 路径
  const apis = [...new Set((html1.match(/\/[a-z0-9_\-/]*service[a-z0-9_\-/]*/gi) || []))].slice(0, 20)
  console.log('[分析] HTML 中出现的 service 路径:', apis.length ? apis.join(', ') : '(无)')
  // 找 JSON 数据块（<script id="__..."> 之类）
  const scripts = [...html1.matchAll(/<script([^>]*)>([\s\S]{0,200})/g)]
    .filter((m) => m[1].includes('type="application/json"') || m[1].match(/id="[^"]*"/))
    .slice(0, 6)
    .map((m) => (m[1].match(/id="([^"]*)"/) || m[1].match(/type="([^"]*)"/) || [])[1] + ' :: ' + m[2].replace(/\s+/g, ' ').slice(0, 100))
  console.log('[分析] 数据脚本块:', scripts.length ? '\n  - ' + scripts.join('\n  - ') : '(未发现)')
  // 检索 busId 上下文
  const bidx = html1.indexOf('900000128833')
  if (bidx > -1) console.log('[分析] busId 上下文:', html1.slice(Math.max(0, bidx - 120), bidx + 120).replace(/\s+/g, ' '))
}

console.log('\n—— 探测完毕 ——')
